/**
 * Script autonome — à lancer depuis VS Code (onglet "Exécuter et déboguer" →
 * "Capturer session Wave", cf. .vscode/launch.json) ou en ligne de commande
 * avec `npm run wave:capture-session`.
 *
 * Ouvre un vrai navigateur Chromium VISIBLE sur ton écran (headless: false —
 * puisqu'on est en local, pas besoin du streaming utilisé par l'écran
 * "navigateur distant" du back-office, cf.
 * src/wave-monitor/wave-remote-browser.service.ts) sur la page Wave
 * Business, te laisse te connecter normalement (PIN + code SMS gérés par
 * Wave), et enregistre directement en base les cookies de session dès que la
 * connexion réussit.
 *
 * Se connecte à la base définie par DATABASE_URL dans backend/.env — donc à
 * la même base que ton serveur si tu utilises le même fichier .env.
 */
import 'dotenv/config';
import * as readline from 'readline';
import { PrismaClient } from '@prisma/client';

const WAVE_BUSINESS_URL = 'https://business.wave.com/';
const SESSION_TTL_MS = 20 * 60 * 60 * 1000; // même durée que WaveSessionService

function waitForEnter(question: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, () => { rl.close(); resolve(); }));
}

// Recherche récursive d'un identifiant de portefeuille dans une réponse
// GraphQL quelconque — même logique que
// WaveRemoteBrowserService.findWalletId (voir ce fichier pour le contexte :
// on ne connaît pas le schéma exact du site web, donc on reste générique
// plutôt que de viser un chemin JSON précis).
function findWalletId(node: unknown, depth = 0): string | null {
  if (!node || depth > 6 || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (/wallet/i.test(key) && value && typeof value === 'object' && 'id' in (value as Record<string, unknown>)) {
      const id = (value as Record<string, unknown>).id;
      if (typeof id === 'string') return id;
    }
    if (value && typeof value === 'object') {
      const found = findWalletId(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function main() {
  const { chromium } = await import('playwright');
  const prisma = new PrismaClient();

  console.log("Ouverture d'un navigateur Chromium visible sur ton écran…");
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await context.newPage();

  let walletId: string | null = null;
  let captured = false;

  async function captureAndSave(reason: string) {
    if (captured) return;
    const cookies = await context.cookies();
    if (!cookies.length) {
      console.log('Aucun cookie trouvé pour le moment — pas encore connecté ?');
      return;
    }
    const sIdCookie = cookies.find((c) => c.name === 'sId');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await prisma.paymentConfig.upsert({ where: { id: 'singleton' }, create: { id: 'singleton' }, update: {} });
    await prisma.paymentConfig.update({
      where: { id: 'singleton' },
      data: {
        ...(sIdCookie ? { waveSessionId: sIdCookie.value } : {}),
        ...(walletId ? { waveWalletId: walletId } : {}),
        waveSessionExpiresAt: expiresAt,
        waveLoginTokenId: null,
        waveRemoteCookiesRaw: cookies as unknown as object,
      },
    });

    captured = true;
    console.log(`\n✅ Session enregistrée (${reason}) — valide jusqu'à ${expiresAt.toLocaleString('fr-FR')}.`);
    if (!sIdCookie) {
      console.log(
        '⚠️  Aucun cookie nommé "sId" trouvé — vérifie la colonne waveRemoteCookiesRaw en base pour identifier le bon nom et ajuste WaveSessionService si besoin.',
      );
    }
  }

  page.on('response', async (res) => {
    if (!/wave\.com/.test(res.url()) || !/graphql/i.test(res.url())) return;
    try {
      const body = await res.json();
      const id = findWalletId(body);
      if (id) {
        walletId = id;
        console.log('Portefeuille Wave détecté — capture automatique en cours…');
        await captureAndSave('détection automatique');
      }
    } catch {
      // Réponse non-JSON (asset statique, redirection...) — on ignore.
    }
  });

  await page.goto(WAVE_BUSINESS_URL, { waitUntil: 'domcontentloaded' });
  console.log(`Page ouverte : ${WAVE_BUSINESS_URL}`);
  console.log('Connecte-toi normalement (PIN + code SMS) dans la fenêtre du navigateur.');
  console.log('La capture se fait automatiquement dès que la connexion réussit.\n');

  // Filet de secours si la détection auto ne se déclenche pas (page Wave
  // différente de ce qu'on anticipe) : appuie sur Entrée une fois connecté
  // pour forcer la capture. Si l'auto-capture a déjà eu lieu, ceci ne fait
  // rien (cf. `if (captured) return;` ci-dessus) — tu peux quand même
  // appuyer sur Entrée pour fermer proprement le script.
  await waitForEnter(
    "Si rien ne se passe après connexion, appuie sur Entrée ici pour forcer la capture (Ctrl+C pour annuler)...\n",
  );
  await captureAndSave('validation manuelle');

  await browser.close();
  await prisma.$disconnect();
  console.log('Terminé.');
}

main().catch((e) => {
  console.error('Erreur :', e);
  process.exit(1);
});
