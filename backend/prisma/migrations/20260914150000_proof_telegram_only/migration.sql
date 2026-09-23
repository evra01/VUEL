-- Les captures ne sont plus stockées (ni DB, ni S3) : elles sont relayées
-- directement vers Telegram. On retire la colonne de fichier "placeholder"
-- et on ajoute la référence au message Telegram correspondant.
ALTER TABLE "ScreenshotProof" DROP COLUMN "fileUrl";
ALTER TABLE "ScreenshotProof" ADD COLUMN "telegramMessageId" INTEGER;
