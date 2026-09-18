// Connexion Wave via navigateur local (VS Code / PC de l'admin)
// ================================================================
// À lancer UNIQUEMENT sur ta machine (pas sur Render) — Playwright a besoin
// d'installer un vrai Chromium visible, ce que le plan gratuit Render ne
// supporte pas de façon fiable (RAM/disque limités).
//
// Ce que fait ce script :
//   1. Ouvre une vraie fenêtre Chromium (visible, pas headless) sur
//      business.wave.com.
//   2. Toi, tu te connectes normalement (numéro, PIN, code SMS reçu) —
//      exactement comme sur le vrai site, rien de spécial à faire.
//   3. Le script détecte automatiquement la connexion réussie (une réponse
//      GraphQL de la page contient un id de portefeuille) et capture les
//      cookies de session.
//   4. Il envoie cette session à ton backend Render (POST
//      /admin/wave-monitor/capture-session) pour que la validation
//      automatique des dépôts puisse s'en servir.
//
// Utilisation (dans VS Code, terminal, depuis le dossier vuel/backend) :
//   npm install                      (une seule fois, si pas déjà fait)
//   npx playwright install chromium  (une seule fois, télécharge Chromium)
//   $env:VUEL_ADMIN_TOKEN="...ton accessToken admin (cf. POST /auth/login)..."
//   node scripts/local-wave-login.js
//
// Si tu n'as pas encore VUEL_ADMIN_TOKEN, connecte-toi d'abord :
//   curl -X POST https://vuel.onrender.com/auth/login -H "Content-Type: application/json" -d "{\"phone\": \"+225...\", \"password\": \"...\"}"
// et copie le champ "accessToken" de la réponse (valable 15 min — si le
// script traîne trop longtemps sans que tu te connectes, relance-le après
// avoir régénéré un token).

const { chromium } = require('playwright');

const WAVE_BUSINESS_URL = 'https://business.wave.com/';
const SERVER_URL = process.env.VUEL_SERVER_URL;
const ADMIN_TOKEN = process.env.VUEL_ADMIN_TOKEN;

if (!SERVER_URL || !ADMIN_TOKEN) {
  console.error('❌ VUEL_SERVER_URL et VUEL_ADMIN_TOKEN doivent être définis avant de lancer ce script (voir commentaire en haut du fichier).');
  process.exit(1);
}

// Recherche récursive d'un identifiant de portefeuille dans une réponse
// GraphQL quelconque — même logique que WaveRemoteBrowserService côté
// serveur, dupliquée ici volontairement (script indépendant, pas de partage
// de code avec le backend NestJS).
function findWalletId(node, depth = 0) {
  if (!node || depth > 6 || typeof node !== 'object') return null;
  for (const [key, value] of Object.entries(node)) {
    if (/wallet/i.test(key) && value && typeof value === 'object' && 'id' in value) {
      if (typeof value.id === 'string') return value.id;
    }
    if (value && typeof value === 'object') {
      const found = findWalletId(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function sendCapturedSession(sessionId, walletId, cookies) {
  const res = await fetch(`${SERVER_URL}/admin/wave-monitor/capture-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify({ sessionId, walletId, cookies }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Backend a refusé (${res.status}) : ${JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  console.log('🌊 Ouverture de Chromium sur business.wave.com — connecte-toi normalement dans la fenêtre qui s\'ouvre.');

  const browser = await chromium.launch({ headless: false }); // headless: false = fenêtre VISIBLE sur ton écran
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();

  let captured = false;
  let lastKnownWalletId = null;

  async function captureAndSend() {
    if (captured) return;
    const cookies = await context.cookies();
    const sIdCookie = cookies.find((c) => c.name === 'sId');
    if (!sIdCookie) {
      // Pas encore de cookie de session trouvé — normal si l'admin n'a pas
      // fini de se connecter, on continue simplement d'attendre.
      return;
    }
    captured = true;
    console.log('✅ Session détectée — envoi au backend Render...');
    try {
      const result = await sendCapturedSession(sIdCookie.value, lastKnownWalletId, cookies);
      console.log(`✅ Session enregistrée côté serveur — valide jusqu'à ${new Date(result.expiresAt).toLocaleString('fr-FR')}.`);
      console.log('Tu peux fermer cette fenêtre Chromium, la validation automatique des dépôts peut maintenant tourner.');
    } catch (e) {
      console.error('❌ Échec de l\'envoi au backend :', e.message);
      console.error('   La session Wave est bien ouverte dans le navigateur, mais pas encore enregistrée côté serveur — corrige l\'erreur ci-dessus et relance le script (reconnecte-toi si besoin).');
      captured = false; // laisse une chance de réessayer automatiquement au prochain événement réseau
    }
  }

  page.on('response', async (res) => {
    const url = res.url();
    if (!/wave\.com/.test(url) || !/graphql/i.test(url)) return;
    let body;
    try {
      body = await res.json();
    } catch {
      return;
    }
    const walletId = findWalletId(body);
    if (walletId) lastKnownWalletId = walletId;
    if (walletId && !captured) {
      console.log('📡 Portefeuille Wave détecté dans une réponse GraphQL — capture automatique.');
      await captureAndSend();
    }
  });

  await page.goto(WAVE_BUSINESS_URL, { waitUntil: 'domcontentloaded' });

  // Filet de sécurité : si la détection automatique ne se déclenche pas
  // (page Wave différente de ce qu'on anticipe), l'admin peut forcer la
  // capture en appuyant sur Entrée dans le terminal une fois connecté.
  console.log('\nSi la capture automatique ne se déclenche pas après connexion, reviens ici et appuie sur Entrée.');
  process.stdin.once('data', () => captureAndSend());

  page.on('close', () => {
    console.log('Fenêtre Chromium fermée.');
    process.exit(captured ? 0 : 1);
  });
}

main().catch((e) => {
  console.error('❌ Erreur :', e);
  process.exit(1);
});
