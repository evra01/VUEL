import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PaymentConfigService } from '../payments/payment-config.service';

const GQL_URL = 'https://ci.mmapp.wave.com/a/business_graphql';
const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'fr-FR,fr;q=0.9',
  'Content-Type': 'application/json',
  Origin: 'https://business.wave.com',
  Referer: 'https://business.wave.com/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
};

export interface WaveIncomingPayment {
  id: string;
  amount: number; // montant brut reçu (= net + frais)
  senderMobile: string | null;
  senderName: string;
  when: string;
}

/// Portage de la classe WaveSession de l'outil "wave-monitor" (Python/FastAPI,
/// projet "Relais Cabine") vers Vuel — même principe : se connecter au compte
/// Wave Business via l'API GraphQL interne utilisée par l'appli mobile Wave
/// Business (PAS l'API Wave Checkout officielle), pour lire l'historique des
/// paiements reçus sans dépendre d'une clé API Wave Business.
///
/// La session (cookie "sId") est persistée dans PaymentConfig (cf. schema.prisma)
/// pour survivre à un redémarrage du serveur sans redemander l'OTP — contexte
/// différent de l'ancienne version standalone qui écrivait dans un fichier
/// monitor_state.json local.
///
/// ATTENTION : ceci repose sur un point d'accès non documenté publiquement
/// par Wave (l'appli mobile Wave Business plutôt qu'une API partenaire) — à
/// surveiller si Wave fait évoluer ce format, et à valider vis-à-vis des
/// conditions d'utilisation de Wave côté produit/juridique.
@Injectable()
export class WaveSessionService {
  private readonly logger = new Logger(WaveSessionService.name);

  constructor(
    private prisma: PrismaService,
    private paymentConfig: PaymentConfigService,
  ) {}

  // Passe par PaymentConfigService.get() (pas un accès prisma direct) : il
  // crée la ligne "singleton" si elle n'existe pas encore, comme le fait déjà
  // WalletService.deposit — évite un crash si le Wave Monitor tourne avant
  // le tout premier dépôt Wave d'un joueur.
  private async config() {
    return this.paymentConfig.get();
  }

  private async gql(query: string, variables: Record<string, unknown>, cookie?: string) {
    const res = await fetch(GQL_URL, {
      method: 'POST',
      headers: cookie ? { ...HEADERS, Cookie: `sId=${cookie}` } : HEADERS,
      body: JSON.stringify({ query, variables }),
    });
    const body = await res.json().catch(() => ({}));
    this.logger.debug(`GQL status=${res.status} body=${JSON.stringify(body).slice(0, 300)}`);
    return body as { data?: any; errors?: { message: string }[] };
  }

  /// Étape 1 : lance l'auth (numéro Wave Business) puis vérifie le PIN
  /// configuré par l'admin (cf. WaveMonitorAdminController) — déclenche
  /// l'envoi d'un OTP par SMS au numéro du compte Wave Business.
  async startLogin(): Promise<{ ok: boolean; message: string }> {
    const config = await this.config();
    if (!config.waveBusinessPhone || !config.waveBusinessPin) {
      return { ok: false, message: 'Renseigne le numéro et le PIN du compte Wave Business avant de te connecter.' };
    }

    const start = await this.gql(
      `mutation StartBusinessUserAuth_Mutation($mobile: String!) {
        startBusinessUserAuth(mobile: $mobile) { nextStep }
      }`,
      { mobile: config.waveBusinessPhone },
    );
    if (start.errors) {
      return { ok: false, message: start.errors[0].message };
    }

    const pin = await this.gql(
      `mutation VerifyPin_Mutation($mobile: String!, $pin: String!, $deviceId: String!) {
        login(mobile: $mobile, pin: $pin, deviceInfo: {
          deviceId: $deviceId, deviceModel: "biz", deviceName: "biz"
        }) {
          token { id mobile length }
        }
      }`,
      {
        mobile: config.waveBusinessPhone,
        pin: config.waveBusinessPin,
        deviceId: config.waveBusinessDeviceId || 'vuel-wave-monitor',
      },
    );
    if (pin.errors) {
      return { ok: false, message: `PIN invalide : ${pin.errors[0].message}` };
    }

    const tokenId = pin.data?.login?.token?.id;
    const otpLength = pin.data?.login?.token?.length ?? 4;
    if (!tokenId) {
      return { ok: false, message: 'Réponse Wave inattendue (pas de tokenId).' };
    }

    await this.prisma.paymentConfig.update({ where: { id: 'singleton' }, data: { waveLoginTokenId: tokenId } });
    return { ok: true, message: `PIN validé — code OTP (${otpLength} chiffres) envoyé par SMS.` };
  }

  /// Étape 2 : soumet le code OTP reçu par SMS → ouvre la session Wave et la
  /// persiste (sId, walletId, expiration ~20h, comme le reste de l'API Wave
  /// Business).
  async submitOtp(otp: string): Promise<{ ok: boolean; message: string }> {
    const config = await this.config();
    if (!config.waveLoginTokenId) {
      return { ok: false, message: "Lance d'abord la connexion (étape PIN) avant de soumettre le code OTP." };
    }

    const result = await this.gql(
      `mutation VerifySMS_Mutation($tokenId: String!, $code: String!, $pin: String!) {
        verifyAuthCode(tokenId: $tokenId, code: $code, pin: $pin) {
          session {
            sId
            user { businessUser { business { wallet { id } id } id } id }
            id
          }
        }
      }`,
      { tokenId: config.waveLoginTokenId, code: otp.trim(), pin: config.waveBusinessPin },
    );
    if (result.errors) {
      return { ok: false, message: `Code OTP invalide : ${result.errors[0].message}` };
    }

    const session = result.data?.verifyAuthCode?.session;
    const sessionId = session?.sId;
    const walletId = session?.user?.businessUser?.business?.wallet?.id;
    if (!sessionId) {
      return { ok: false, message: 'Réponse Wave inattendue (pas de session).' };
    }

    const expiresAt = new Date(Date.now() + 20 * 60 * 60 * 1000); // session Wave valide ~20h
    await this.prisma.paymentConfig.update({
      where: { id: 'singleton' },
      data: {
        waveSessionId: sessionId,
        waveWalletId: walletId ?? null,
        waveSessionExpiresAt: expiresAt,
        waveLoginTokenId: null,
      },
    });
    this.logger.log(`Session Wave ouverte — expire à ${expiresAt.toISOString()}`);
    return { ok: true, message: `Connecté — session valide jusqu'à ${expiresAt.toLocaleString('fr-FR')}.` };
  }

  /// État courant de la session (pour l'écran admin) — ne renvoie jamais le
  /// PIN en clair.
  async getStatus() {
    const config = await this.config();
    const active = !!(config.waveSessionId && config.waveSessionExpiresAt && config.waveSessionExpiresAt > new Date());
    return {
      enabled: config.waveMonitorEnabled,
      businessPhone: config.waveBusinessPhone, // pas secret, affiché tel quel dans le back-office
      businessDeviceId: config.waveBusinessDeviceId,
      phoneConfigured: !!config.waveBusinessPhone,
      pinConfigured: !!config.waveBusinessPin,
      sessionActive: active,
      pendingOtp: !active && !!config.waveLoginTokenId,
      expiresAt: config.waveSessionExpiresAt,
      walletId: config.waveWalletId,
    };
  }

  /// Session valide en mémoire/DB ? Ne tente PAS de reconnexion automatique
  /// (l'OTP par SMS ne peut être soumis que par un admin) — cf.
  /// WaveMonitorService.checkAndValidate qui alerte l'admin par Telegram si
  /// la session est expirée.
  async isSessionValid(): Promise<boolean> {
    const config = await this.config();
    return !!(config.waveSessionId && config.waveSessionExpiresAt && config.waveSessionExpiresAt > new Date());
  }

  /// Récupère les paiements marchands ("MerchantSaleEntry") reçus aujourd'hui
  /// sur le compte Wave Business, avec le numéro de l'expéditeur — c'est ce
  /// numéro qui permet de matcher avec Transaction.payerPhone (cf.
  /// WaveMonitorService), plus fiable que le matching par montant seul de
  /// l'ancienne version standalone.
  async getTodayIncomingPayments(): Promise<WaveIncomingPayment[]> {
    const config = await this.config();
    if (!config.waveSessionId || !config.waveWalletId) return [];

    const today = new Date().toISOString().slice(0, 10);
    const result = await this.gql(
      `query HistoryEntries_BusinessWalletHistoryQuery(
        $start: Date!, $end: Date!, $walletOpaqueId: String!, $limit: Int
      ) {
        me {
          businessUser {
            business {
              walletHistory(
                start: $start, end: $end,
                walletOpaqueId: $walletOpaqueId,
                limit: $limit, includePending: false
              ) {
                historyEntries {
                  __typename
                  id
                  amount
                  whenEntered
                  isPending
                  isCancelled
                  summary
                  ... on MerchantSaleEntry {
                    customerName: senderName
                    senderMobile
                    grossAmount
                  }
                }
              }
              id
            }
            id
          }
          id
        }
      }`,
      { start: today, end: today, walletOpaqueId: config.waveWalletId, limit: 50 },
      config.waveSessionId,
    );

    if (result.errors) {
      const message = result.errors[0]?.message ?? '';
      if (/auth|session|unauthorized/i.test(message)) {
        this.logger.warn('Session Wave expirée ou invalide — reconnexion admin nécessaire.');
        await this.prisma.paymentConfig.update({
          where: { id: 'singleton' },
          data: { waveSessionId: null, waveSessionExpiresAt: null },
        });
      } else {
        this.logger.error(`walletHistory: ${message}`);
      }
      return [];
    }

    const entries: any[] = result.data?.me?.businessUser?.business?.walletHistory?.historyEntries ?? [];
    return entries
      .filter((e) => e.__typename === 'MerchantSaleEntry' && !e.isPending && !e.isCancelled)
      .map((e) => ({
        id: String(e.id ?? ''),
        amount: this.toInt(e.grossAmount ?? e.amount ?? 0),
        senderMobile: e.senderMobile ?? null,
        senderName: e.customerName ?? e.summary ?? '?',
        when: e.whenEntered ?? '',
      }))
      .filter((e) => !!e.id);
  }

  // Wave renvoie parfois les montants en centimes selon l'endpoint — ce
  // garde-fou (identique à l'ancienne version standalone) évite un montant
  // ×100 si jamais le format change.
  private toInt(value: unknown): number {
    const n = typeof value === 'string' ? parseInt(value.replace(/[^\d]/g, ''), 10) || 0 : Number(value) || 0;
    return n > 1_000_000 ? Math.round(n / 100) : n;
  }
}
