-- Wave Monitor intégré au backend (remplace le script externe
-- vuel_wave_monitor.py) — ajoute à PaymentConfig les champs utilisés par
-- WaveSessionService (connexion directe API interne Wave Business) et
-- WaveRemoteBrowserService (connexion via navigateur headless piloté par
-- l'admin, sans jamais stocker le PIN).
--
-- IF NOT EXISTS sur chaque colonne : rend la migration rejouable sans erreur
-- si une ou plusieurs colonnes existent déjà en base (ex: ajoutées
-- manuellement lors d'un essai précédent) — ne recrée que ce qui manque.
--
-- SECURITE : waveBusinessPin est stocké en clair par le code actuel
-- (WaveSessionService). C'est un secret sensible (equivalent mot de passe
-- bancaire) - a chiffrer avant tout usage avec de vrais identifiants en
-- production. Privilegier WaveRemoteBrowserService (methode 2) qui ne
-- necessite jamais de connaitre le PIN cote serveur.
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveBusinessPhone" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveBusinessPin" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveBusinessDeviceId" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveLoginTokenId" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveRemoteCookiesRaw" JSONB;
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveSessionId" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveSessionExpiresAt" TIMESTAMP(3);
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveWalletId" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN IF NOT EXISTS "waveMonitorEnabled" BOOLEAN NOT NULL DEFAULT false;
