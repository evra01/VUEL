import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';
import type { Browser, BrowserContext, CDPSession, Page, Response } from 'playwright';
import { PrismaService } from '../common/prisma.service';
import { PaymentConfigService } from '../payments/payment-config.service';

// URL du vrai portail web Wave Business (PAS l'API interne utilisée par
// WaveSessionService) — c'est cette page, affichée par un Chromium headless
// côté serveur et retransmise en direct au back-office (cf.
// WaveRemoteBrowserGateway), que l'admin utilise pour se connecter comme il
// le ferait normalement, sans passer par un formulaire PIN maison.
const WAVE_BUSINESS_URL = 'https://business.wave.com/';

// Ferme le navigateur tout seul si personne ne termine la connexion — évite
// un Chromium headless oublié en arrière-plan (RAM/CPU) si l'onglet du
// back-office reste ouvert sans action.
const SESSION_TIMEOUT_MS = 10 * 60 * 1000;

export interface RemoteBrowserFrame {
  data: string; // JPEG en base64 (cf. CDP Page.screencastFrame)
  width: number;
  height: number;
}

/// Pilote un vrai Chromium headless (Playwright) sur la page de connexion
/// Wave Business, retransmis en direct au back-office (captures d'écran CDP)
/// — l'admin s'y connecte EXACTEMENT comme sur le vrai site (PIN + OTP gérés
/// par Wave, pas par notre code), et dès qu'une réponse GraphQL de la page
/// laisse deviner une session active (présence d'un id de portefeuille), on
/// capture les cookies de session et on les enregistre. Alternative à
/// WaveSessionService.startLogin/submitOtp (qui reste utilisable en secours),
/// qui elle stocke le PIN Wave dans notre base et rejoue l'appel GraphQL
/// nous-mêmes.
///
/// IMPORTANT — à vérifier à la toute première connexion réelle : on ignore,
/// sans avoir testé, si le cookie de session posé par business.wave.com
/// s'appelle bien "sId" (comme celui de l'API mobile déjà rétro-ingéniérée
/// dans WaveSessionService) ou porte un autre nom. Cette classe : (1) cherche
/// un cookie "sId" en priorité pour rester compatible telle quelle avec
/// WaveSessionService.getTodayIncomingPayments, (2) garde de toute façon TOUS
/// les cookies capturés dans PaymentConfig.waveRemoteCookiesRaw pour
/// inspection/correction manuelle si (1) ne donne rien.
@Injectable()
export class WaveRemoteBrowserService implements OnModuleDestroy {
  private readonly logger = new Logger(WaveRemoteBrowserService.name);
  readonly events = new EventEmitter();

  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private timeoutHandle: NodeJS.Timeout | null = null;
  private captured = false;
  private lastKnownWalletId: string | null = null;

  constructor(
    private prisma: PrismaService,
    private paymentConfig: PaymentConfigService,
  ) {}

  get running() {
    return !!this.browser;
  }

  /// Lance le navigateur distant et commence à diffuser des images (cf.
  /// WaveRemoteBrowserGateway, qui écoute events.on('frame', ...)). Ne fait
  /// rien si une session tourne déjà (un seul navigateur distant à la fois).
  async start(): Promise<void> {
    if (this.browser) return;

    // Import paresseux : évite de charger Playwright (et son binaire
    // Chromium, ~300 Mo) au démarrage du serveur si cet écran n'est jamais
    // utilisé. Nécessite `npx playwright install chromium` sur le serveur
    // (cf. WAVE_MONITOR_CHANGES.md) — absent, `start()` échoue proprement.
    const { chromium } = await import('playwright');

    this.captured = false;
    this.lastKnownWalletId = null;
    this.browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    this.context = await this.browser.newContext({ viewport: { width: 1366, height: 768 } });
    this.page = await this.context.newPage();

    this.page.on('response', (res) => this.onResponse(res).catch((e) => this.logger.debug(String(e))));
    this.page.on('close', () => {
      this.events.emit('closed');
      this.stop().catch(() => {});
    });

    this.cdp = await this.context.newCDPSession(this.page);
    this.cdp.on('Page.screencastFrame', (frame: any) => {
      this.events.emit('frame', { data: frame.data, width: 1366, height: 768 } as RemoteBrowserFrame);
      this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {});
    });
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 1366, maxHeight: 768 });

    await this.page.goto(WAVE_BUSINESS_URL, { waitUntil: 'domcontentloaded' }).catch((e) => {
      this.logger.error(`Navigation vers ${WAVE_BUSINESS_URL} impossible : ${e}`);
    });

    this.timeoutHandle = setTimeout(() => {
      this.logger.warn('Session navigateur distant expirée (10 min sans connexion) — fermeture automatique.');
      this.events.emit('timeout');
      this.stop().catch(() => {});
    }, SESSION_TIMEOUT_MS);
  }

  async stop(): Promise<void> {
    if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
    this.timeoutHandle = null;
    await this.cdp?.send('Page.stopScreencast').catch(() => {});
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdp = null;
  }

  async onModuleDestroy() {
    await this.stop();
  }

  // --- Relais clavier/souris : on pilote directement la vraie page Wave via
  // l'API haut-niveau de Playwright (page.mouse / page.keyboard), pas de
  // ré-implémentation maison des codes de touches CDP.
  async mouseMove(x: number, y: number) {
    await this.page?.mouse.move(x, y).catch(() => {});
  }
  async mouseDown() {
    await this.page?.mouse.down().catch(() => {});
  }
  async mouseUp() {
    await this.page?.mouse.up().catch(() => {});
  }
  async wheel(deltaX: number, deltaY: number) {
    await this.page?.mouse.wheel(deltaX, deltaY).catch(() => {});
  }
  async key(key: string) {
    if (!this.page) return;
    try {
      // Un seul caractère imprimable (chiffre du PIN/OTP, lettre...) → type()
      // simule la frappe complète ; les touches spéciales (Backspace, Enter,
      // Tab...) passent par press() avec le nom DOM tel quel (compatible avec
      // la nomenclature attendue par Playwright pour les touches courantes).
      if (key.length === 1) {
        await this.page.keyboard.type(key);
      } else {
        await this.page.keyboard.press(key);
      }
    } catch (e) {
      this.logger.debug(`Touche "${key}" ignorée : ${e}`);
    }
  }

  /// Capture les cookies de la session en cours et les enregistre — déclenché
  /// automatiquement (cf. onResponse) ou manuellement via le bouton "J'ai
  /// terminé ma connexion" du back-office si la détection auto ne se
  /// déclenche pas (page Wave différente de ce qu'on anticipe).
  async captureNow(): Promise<{ ok: boolean; message: string }> {
    if (!this.context) {
      return { ok: false, message: 'Aucune session de navigateur distant en cours — clique sur "Démarrer" d\'abord.' };
    }
    const cookies = await this.context.cookies();
    if (!cookies.length) {
      return { ok: false, message: 'Aucun cookie trouvé — connecte-toi d\'abord sur la page Wave affichée ci-dessus.' };
    }

    const sIdCookie = cookies.find((c) => c.name === 'sId');
    const expiresAt = new Date(Date.now() + 20 * 60 * 60 * 1000); // même durée que WaveSessionService

    await this.paymentConfig.get(); // crée la ligne "singleton" si besoin
    await this.prisma.paymentConfig.update({
      where: { id: 'singleton' },
      data: {
        ...(sIdCookie ? { waveSessionId: sIdCookie.value } : {}),
        ...(this.lastKnownWalletId ? { waveWalletId: this.lastKnownWalletId } : {}),
        waveSessionExpiresAt: expiresAt,
        waveLoginTokenId: null,
        waveRemoteCookiesRaw: cookies as unknown as object,
      },
    });

    this.captured = true;
    this.events.emit('captured', { hasSId: !!sIdCookie, walletId: this.lastKnownWalletId });

    return sIdCookie
      ? { ok: true, message: `Session capturée (cookie "sId" trouvé) — valide jusqu'à ${expiresAt.toLocaleString('fr-FR')}.` }
      : {
          ok: true,
          message:
            'Cookies enregistrés, mais aucun cookie nommé "sId" trouvé — vérifie le champ waveRemoteCookiesRaw en base pour identifier le bon nom et ajuste WaveSessionService si besoin.',
        };
  }

  private async onResponse(res: Response) {
    const url = res.url();
    if (!/wave\.com/.test(url) || !/graphql/i.test(url)) return;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return; // pas du JSON (asset statique, redirection...) — on ignore
    }

    const walletId = this.findWalletId(body);
    if (walletId) this.lastKnownWalletId = walletId;

    // Signal de connexion réussie : une réponse GraphQL de la page renvoie un
    // id de portefeuille → capture automatique (une seule fois par session ;
    // l'admin peut forcer une nouvelle capture via captureNow() sinon).
    if (walletId && !this.captured) {
      this.logger.log('Portefeuille Wave détecté dans une réponse GraphQL — capture automatique des cookies.');
      await this.captureNow().catch((e) => this.logger.error(`Capture automatique échouée : ${e}`));
    }
  }

  // Recherche récursive et prudente d'un identifiant de portefeuille dans une
  // réponse GraphQL quelconque — contrairement à l'API mobile déjà
  // rétro-ingéniérée dans WaveSessionService, on ne connaît pas le schéma
  // exact du site web, donc on reste générique plutôt que de viser un chemin
  // JSON précis qui pourrait ne jamais correspondre.
  private findWalletId(node: unknown, depth = 0): string | null {
    if (!node || depth > 6 || typeof node !== 'object') return null;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (/wallet/i.test(key) && value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
        const id = (value as Record<string, unknown>).id;
        if (typeof id === 'string') return id;
      }
      if (value && typeof value === 'object') {
        const found = this.findWalletId(value, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }
}
