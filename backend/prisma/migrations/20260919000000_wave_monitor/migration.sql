-- Wave Monitor : validation automatique des dépôts Wave (en plus de la
-- validation manuelle Telegram existante). Identifiants du compte Wave
-- Business + session persistée sur PaymentConfig, et table d'anti-doublon
-- pour les paiements Wave déjà traités.
ALTER TABLE "PaymentConfig" ADD COLUMN "waveMonitorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PaymentConfig" ADD COLUMN "waveBusinessPhone" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN "waveBusinessPin" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN "waveBusinessDeviceId" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN "waveSessionId" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN "waveWalletId" TEXT;
ALTER TABLE "PaymentConfig" ADD COLUMN "waveSessionExpiresAt" TIMESTAMP(3);
ALTER TABLE "PaymentConfig" ADD COLUMN "waveLoginTokenId" TEXT;

CREATE TABLE "WaveSeenTransaction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaveSeenTransaction_pkey" PRIMARY KEY ("id")
);
