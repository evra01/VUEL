-- Wave Monitor : connexion via navigateur distant (cf. WaveRemoteBrowserService)
-- Stocke la capture brute de tous les cookies obtenus après une connexion
-- manuelle de l'admin sur la vraie page Wave Business, en secours/débogage
-- si le cookie de session utilisé par le site web ne s'appelle pas "sId"
-- (contrairement à celui déjà géré par waveSessionId, cf. WaveSessionService).
ALTER TABLE "PaymentConfig" ADD COLUMN "waveRemoteCookiesRaw" JSONB;
