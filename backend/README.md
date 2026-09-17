# Vuel — Back-end API

Squelette NestJS + Prisma (PostgreSQL) + BullMQ (Redis), basé sur le cahier des charges Vuel.

## Démarrage

```bash
npm install
cp .env.example .env   # renseigner DATABASE_URL, JWT_SECRET, etc.
npx prisma migrate dev --name init
npm run start:dev
```

## Modules implémentés (structure + logique métier centrale)

| Module | Contenu |
|---|---|
| `auth` | Inscription avec OTP SMS, login, JWT access/refresh |
| `users` | Profil, device info, gaming IDs (eFootball/CODM/Ludo), avatar |
| `wallet` | Solde, dépôt (paiement par lien Wave), retrait (KYC requis) |
| `duels` | Création/jointure de salons, cycle de vie du match |
| `duels` (gateway) | Salon temps réel WebSocket : échange auto des IDs, chat, état « Prêt »/« Lancer » |
| `escrow` | Séquestre des mises, calcul commission, libération des fonds |
| `captures` | Réception des screenshots, mise en file OCR |
| `ocr` | Worker asynchrone (BullMQ) de validation des scores |
| `disputes` | Signalement de litige + dossier complet (duel, captures, escrow) + résolution par un arbitre |
| `reputation` | Sanctions de réputation, seuil de bannissement |
| `admin` | Gestion des rôles (PLAYER/ARBITER/ADMIN), liste des utilisateurs, stats back-office |
| `payments` | Intégration Wave Checkout (paiement par lien) + config admin + webhook de confirmation |
| `tournaments` | Organisation de tournois par les joueurs (mise min. 200 FCFA), bracket à élimination directe, prize pool |
| `notifications` | Envoi de SMS (Twilio) et d'emails (SMTP) + config admin — utilisés par `auth` pour l'OTP d'inscription |

## Ce qui reste à brancher (marqué `TODO` dans le code)

- **Paiements** : Wave Checkout (paiement par lien) implémenté pour les dépôts — clé API à renseigner via `PATCH /admin/payment-config` (ADMIN uniquement). Deux façons de confirmer un paiement :
  - `POST /webhooks/wave` — reçoit directement le webhook Wave (signature non vérifiée pour l'instant, `verifyWebhookSignature` retourne toujours `true`, à corriger avant la prod)
  - `POST /webhooks/payment-confirmation` — **recommandé** : format simple `{ transactionId, status, externalRef? }`, authentifié par header `X-Webhook-Secret` (valeur à définir via `PATCH /admin/payment-config`, champ `webhookSharedSecret`). Prévu pour un workflow externe de vérification (n8n/Make/Zapier) qui reçoit le webhook Wave, le vérifie lui-même, puis confirme ici. Idempotent : un appel sur une transaction déjà traitée est ignoré sans erreur.
  
  Retraits, Orange Money/MTN MoMo/carte restent des TODO.
- **OTP SMS** : implémenté — code stocké dans Redis avec TTL 5 min (`OtpService`), envoyé via Twilio (`SmsService`). Identifiants Twilio à renseigner via `PATCH /admin/sms-config` (ADMIN uniquement, jamais renvoyés en clair par la suite). **Mode dev** : si Twilio n'est pas configuré, le code s'affiche simplement dans les logs du terminal (`SmsService`, niveau `warn`) au lieu d'échouer — pratique pour tester sans compte Twilio, mais **à retirer avant la prod** (n'importe qui lisant les logs serveur pourrait voir l'OTP de n'importe qui).
- **OTP email (doublon du SMS)** : le même code part aussi par email — l'adresse est **obligatoire** à l'inscription (`RegisterDto.email`, `@IsEmail`) (`EmailService`, SMTP via nodemailer). Les deux envois sont tentés en parallèle et l'inscription réussit dès qu'**au moins un** aboutit — un SMS bloqué par l'opérateur ne bloque donc plus la création de compte. La réponse de `POST /auth/register` contient `channels: { sms, email }` pour que le client n'annonce que les canaux réellement partis. Config SMTP via `PATCH /admin/email-config` (page « Email (SMTP) » du back-office), avec `POST /admin/email-config/test` pour vérifier les identifiants sans créer de compte. Même mode dev que pour le SMS : sans SMTP configuré, l'email est écrit dans les logs.
- **OCR** : appel Google Cloud Vision API (+ fallback Tesseract) et parsing du score détecté
- **Stockage** : upload chiffré des captures vers S3-compatible
- **Notifications** : intégration Firebase Cloud Messaging
- **Avatar** : `PATCH /users/me/avatar` — le joueur choisit une icône parmi une liste fixe (`AVATAR_ICON_IDS`), aucun upload de fichier, aucune photo
- **Rôles admin/arbitre** : implémenté (`UserRole` sur `User`, `RolesGuard` branché). Pas d'endpoint pour se créer soi-même ADMIN — utiliser `npm run seed:admin` (variables `SEED_ADMIN_PHONE` / `SEED_ADMIN_PASSWORD`) pour le tout premier compte, puis `PATCH /admin/users/:id/role` pour les suivants.
- **État "prêt" du salon** : gardé en mémoire dans `DuelRoomGateway` — à migrer vers Redis si l'app tourne sur plusieurs instances
- **Chat du salon de duel** : non persisté actuellement — à ajouter si le contenu doit servir de preuve en cas de litige (cf. `disputes.service.ts`)
- **Tournois** : n'importe quel joueur peut en organiser un (`POST /tournaments`), mise minimum 200 FCFA validée par DTO (`MIN_TOURNAMENT_STAKE`). Bracket à élimination directe généré automatiquement (`TournamentsService`) — chaque match est un `Duel` classique (avec `tournamentId`/`tournamentRound`) mais sans escrow individuel : les mises sont collectées une fois à l'inscription (`join`) et le prize pool entier est versé au vainqueur final moins la commission (`finalize`, appelé automatiquement quand il ne reste qu'un participant actif). `POST /tournaments/:id/cancel` (organisateur) rembourse tous les participants (mise recréditée sur `balanceAvailable`) et annule les matchs de bracket en cours. Limite connue : pas de gestion fine des égalités/forfaits au-delà du flux dispute existant.
- **Remboursements** : nouveau type `REFUND` + `EscrowService.refund()` pour annuler un duel classique et rendre leur mise aux deux joueurs sans commission — via `POST /duels/:id/cancel` (réservé aux deux joueurs du duel), `POST /admin/duels/:id/cancel` (n'importe quel admin, sans vérification de participant — page « Duels » du back-office, utile pour un salon coincé ou un abus signalé hors du circuit litige), ou via `POST /admin/disputes/:id/resolve` avec `voidMatch: true` si l'arbitre juge le litige non tranchable. Un duel de tournoi ne peut pas être annulé individuellement (mises mutualisées) — il faut annuler le tournoi entier.
- Tests unitaires et e2e

## Schéma de données

Voir `prisma/schema.prisma` — couvre `User`, `GamingId`, `Wallet`, `Transaction`, `Duel`, `Escrow`,
`ScreenshotProof`, `Dispute`.
