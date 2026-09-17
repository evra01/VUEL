-- file_id Telegram de la capture (en plus de telegramMessageId déjà existant)
-- — permet de re-télécharger l'image à la demande via l'API getFile pour
-- l'afficher dans la page admin (cf. AdminProofsController), sans dupliquer
-- le stockage de l'image nulle part côté serveur.
ALTER TABLE "ScreenshotProof" ADD COLUMN "telegramFileId" TEXT;
