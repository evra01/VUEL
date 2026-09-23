-- Heartbeat du monitor externe vuel_wave_monitor.py (cf. WaveMonitorStatus
-- dans schema.prisma) — permet au back-office admin de voir si le monitor
-- tourne encore plutôt que de le découvrir via des dépôts bloqués.
CREATE TABLE "WaveMonitorStatus" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "waveSessionActive" BOOLEAN NOT NULL DEFAULT false,
    "waveExpiresAt" TIMESTAMP(3),
    "lastCycleValidated" INTEGER NOT NULL DEFAULT 0,
    "totalValidated" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,

    CONSTRAINT "WaveMonitorStatus_pkey" PRIMARY KEY ("id")
);
