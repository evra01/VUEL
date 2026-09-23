-- Bannières promo de l'écran d'accueil — l'image elle-même n'est jamais
-- stockée ici (voir commentaire du modèle Banner dans schema.prisma), on ne
-- garde que la référence Telegram (telegramFileId) pour la retélécharger à
-- la demande.
CREATE TABLE "Banner" (
    "id" TEXT NOT NULL,
    "telegramFileId" TEXT NOT NULL,
    "telegramMessageId" INTEGER,
    "linkUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Banner_pkey" PRIMARY KEY ("id")
);
