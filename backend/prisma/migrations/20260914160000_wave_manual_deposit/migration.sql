-- Passage du dépôt Wave à un lien fixe + validation manuelle (Telegram),
-- au lieu de l'API Checkout Wave Business (clé API + webhook auto).
-- cf. PaymentConfig.waveDepositLink (nouveau) et Transaction.payerPhone
-- (numéro saisi par le joueur, pour que l'admin retrouve le paiement reçu).
ALTER TABLE "PaymentConfig" ADD COLUMN "waveDepositLink" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "payerPhone" TEXT;
