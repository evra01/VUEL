-- Wave Monitor intégré au backend (remplace le script externe
-- vuel_wave_monitor.py) — ajoute à PaymentConfig les champs utilisés par
-- WaveSessionService (connexion directe API interne Wave Business) et
-- WaveRemoteBrowserService (connexion via navigateur headless piloté par
-- l'admin, sans jamais stocker le PIN).
--
-- SECURITE : waveBusinessPin est stocké en clair par le code actuel
-- (WaveSessionService). C'est un secret sensible (equivalent mot de passe
-- bancaire) - a chiffrer avant tout usage avec de vrais identifiants en
-- production. Privilegier WaveRemoteBrowserService (methode 2) qui ne
-- necessite jamais de connaitre le PIN cote serveur.
ALTER TABLE "PaymentConfig"
  ADD COLUMN "waveBusinessPhone" TEXT,
  ADD COLUMN "waveBusinessPin" TEXT,
  ADD COLUMN "waveBusinessDeviceId" TEXT,
  ADD COLUMN "waveLoginTokenId" TEXT,
  ADD COLUMN "waveRemoteCookiesRaw" JSONB,
  ADD COLUMN "waveSessionId" TEXT,
  ADD COLUMN "waveSessionExpiresAt" TIMESTAMP(3),
  ADD COLUMN "waveWalletId" TEXT,
  ADD COLUMN "waveMonitorEnabled" BOOLEAN NOT NULL DEFAULT false;
