-- Index de performance — aucun de ces champs n'était indexé au-delà des clés
-- uniques/primaires, alors qu'ils sont filtrés à chaque chargement des écrans
-- "Jouer"/"Accueil" côté app (Duel.status, playerAId/playerBId+status) et des
-- pages "Dépôts"/"Retraits"/"Litiges" côté back-office (Transaction, Dispute).
-- Sans eux, chacun de ces appels très fréquents fait un balayage complet de
-- la table à mesure qu'elle grossit — l'une des causes des chargements lents.
CREATE INDEX "Duel_status_idx" ON "Duel"("status");
CREATE INDEX "Duel_playerAId_status_idx" ON "Duel"("playerAId", "status");
CREATE INDEX "Duel_playerBId_status_idx" ON "Duel"("playerBId", "status");

CREATE INDEX "Transaction_walletId_idx" ON "Transaction"("walletId");
CREATE INDEX "Transaction_type_status_idx" ON "Transaction"("type", "status");

CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");
