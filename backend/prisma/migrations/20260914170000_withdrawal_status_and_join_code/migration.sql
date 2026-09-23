-- Statuts supplémentaires pour les retraits : "Annulé" (recrédit du solde,
-- remplace l'usage de FAILED pour les retraits) et "Autre" (cas particulier
-- laissé à l'appréciation de l'admin) — cf. AdminController withdrawals/*.
ALTER TYPE "TransactionStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "TransactionStatus" ADD VALUE 'OTHER';

-- Code court unique du salon, affiché/partagé à la place de l'UUID `id`
-- (cf. DuelsService.generateJoinCode, DuelInviteController). Nullable pour
-- les duels déjà existants.
ALTER TABLE "Duel" ADD COLUMN "joinCode" TEXT;
CREATE UNIQUE INDEX "Duel_joinCode_key" ON "Duel"("joinCode");

-- Note libre laissée par l'admin en traitant une transaction (ex: retrait
-- marqué "Autre" — cf. MarkWithdrawalOtherDto).
ALTER TABLE "Transaction" ADD COLUMN "adminNote" TEXT;
