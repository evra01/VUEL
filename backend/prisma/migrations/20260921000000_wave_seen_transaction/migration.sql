-- Table de déduplication des paiements Wave déjà traités par
-- WaveMonitorService (évite un double traitement si le même paiement
-- réapparaît dans plusieurs cycles de polling de l'historique Wave).
CREATE TABLE IF NOT EXISTS "WaveSeenTransaction" (
    "id" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaveSeenTransaction_pkey" PRIMARY KEY ("id")
);
