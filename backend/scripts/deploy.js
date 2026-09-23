// Script de déploiement "auto-réparant" pour Render.
//
// Problème résolu : si une migration Prisma échoue en plein milieu (ex:
// colonne déjà existante en base suite à un essai manuel précédent), Prisma
// la marque comme "en échec" dans la table _prisma_migrations et REFUSE
// ensuite toute nouvelle migration tant qu'on n'a pas explicitement résolu
// ça (normalement via `prisma migrate resolve`, lancé à la main). Comme ce
// projet n'a pas de Shell Render (plan gratuit), ce script fait cette
// réparation automatiquement à chaque build, avant de lancer les migrations.
//
// Ce qu'il fait, dans l'ordre :
//   1. Se connecte directement à la base via DATABASE_URL (déjà disponible
//      côté Render au moment du build).
//   2. Cherche dans _prisma_migrations une migration "en échec" (finished_at
//      NULL, rolled_back_at NULL) — s'il y en a une, la marque comme
//      "rolled back" (rolled_back_at = maintenant), exactement ce que fait
//      `prisma migrate resolve --rolled-back` à la main.
//   3. Lance `prisma generate` puis `prisma migrate deploy` normalement.
//
// Sans danger si rien n'est cassé : si aucune migration n'est en échec,
// l'étape 2 ne fait rien et le script se comporte comme un `migrate deploy`
// classique.
const { Client } = require('pg');
const { execSync } = require('child_process');

async function repairFailedMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log('[deploy] DATABASE_URL absent — on laisse prisma migrate deploy gérer ça normalement.');
    return;
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();

    // La table _prisma_migrations n'existe pas encore sur une toute première
    // installation (aucune migration jamais appliquée) — dans ce cas il n'y a
    // rien à réparer, migrate deploy va simplement tout créer depuis zéro.
    const tableCheck = await client.query(
      `SELECT to_regclass('public._prisma_migrations') AS exists`,
    );
    if (!tableCheck.rows[0].exists) {
      console.log('[deploy] Première installation (pas encore de table _prisma_migrations) — rien à réparer.');
      return;
    }

    const failed = await client.query(
      `SELECT migration_name FROM _prisma_migrations
       WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    );

    if (failed.rows.length === 0) {
      console.log('[deploy] Aucune migration bloquée en échec — rien à réparer.');
      return;
    }

    for (const row of failed.rows) {
      console.log(`[deploy] Migration en échec détectée : ${row.migration_name} — marquage comme "rolled back" pour permettre une nouvelle tentative.`);
      await client.query(
        `UPDATE _prisma_migrations SET rolled_back_at = NOW() WHERE migration_name = $1 AND finished_at IS NULL AND rolled_back_at IS NULL`,
        [row.migration_name],
      );
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  await repairFailedMigrations();

  console.log('[deploy] npx prisma generate');
  execSync('npx prisma generate', { stdio: 'inherit' });

  console.log('[deploy] npx prisma migrate deploy');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  // Chromium pour WaveRemoteBrowserService (navigateur distant piloté par
  // l'admin) — ~300 Mo à télécharger, ce qui peut être lourd/lent sur le
  // plan gratuit Render (RAM et disque limités). Non-bloquant : si ça
  // échoue (quota dépassé, timeout...), on continue le déploiement sans
  // cette fonctionnalité plutôt que de faire échouer tout le build ; le
  // reste de l'app (webhooks, WaveSessionService méthode PIN, etc.) n'en
  // dépend pas.
  try {
    console.log('[deploy] npx playwright install --with-deps chromium');
    execSync('npx playwright install --with-deps chromium', { stdio: 'inherit' });
  } catch (e) {
    console.warn('[deploy] Installation de Chromium (Playwright) échouée — WaveRemoteBrowserService ne fonctionnera pas, mais le reste du déploiement continue.', e.message);
  }

  console.log('[deploy] nest build');
  execSync('npx nest build', { stdio: 'inherit' });
}

main().catch((e) => {
  console.error('[deploy] Échec :', e);
  process.exit(1);
});
