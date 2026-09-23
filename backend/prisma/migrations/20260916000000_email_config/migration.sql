-- Configuration SMTP utilisée pour envoyer le code OTP par email en plus du SMS
-- (cf. modèle EmailConfig dans schema.prisma). Ligne unique ("singleton"),
-- remplie depuis le back-office admin — aucune valeur n'est mise ici par défaut.
CREATE TABLE "EmailConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "smtpHost" TEXT,
    "smtpPort" INTEGER DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpUser" TEXT,
    "smtpPassword" TEXT,
    "fromEmail" TEXT,
    "fromName" TEXT DEFAULT 'Vuel',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailConfig_pkey" PRIMARY KEY ("id")
);
