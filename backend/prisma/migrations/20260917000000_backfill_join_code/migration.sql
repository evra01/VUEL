-- Comble le manque laissé par la migration 20260914170000 : celle-ci a
-- ajouté "joinCode" en NULLABLE sans backfill, donc tout duel créé avant
-- elle a joinCode = NULL. Deux effets visibles côté produit :
--   1. Le lien de partage retombe sur l'UUID technique du duel (cf.
--      DuelInviteController / duel_share.dart, qui font `joinCode ?? duelId`)
--      au lieu du code court à 6 caractères.
--   2. Dans l'app, le bloc "copier le code" du salon ne s'affiche même pas
--      (cf. DuelRoomScreen, conditionné sur `widget.joinCode != null`) — pas
--      de bouton du tout, pas seulement un code moins lisible.
--
-- On génère donc un code aléatoire (même alphabet que
-- DuelsService.generateJoinCode — ABCDEFGHJKMNPQRSTUVWXYZ23456789, sans
-- 0/O/1/I pour éviter les confusions à la lecture) pour chaque duel qui n'en
-- a pas encore, avec réessai en cas de collision sur la contrainte unique.
DO $$
DECLARE
  alphabet TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  duel_row RECORD;
  candidate TEXT;
  i INT;
BEGIN
  FOR duel_row IN SELECT "id" FROM "Duel" WHERE "joinCode" IS NULL LOOP
    LOOP
      candidate := '';
      FOR i IN 1..6 LOOP
        candidate := candidate || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      END LOOP;

      BEGIN
        UPDATE "Duel" SET "joinCode" = candidate WHERE "id" = duel_row."id";
        EXIT; -- succès, on passe au duel suivant
      EXCEPTION WHEN unique_violation THEN
        -- collision improbable sur "joinCode" — on retire un autre candidat
        CONTINUE;
      END;
    END LOOP;
  END LOOP;
END $$;
