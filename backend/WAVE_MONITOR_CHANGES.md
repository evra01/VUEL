# Wave Monitor — adaptation à Vuel

Portage de l'outil `wave_monitor.py` (projet Relais Cabine) dans le back-end
NestJS de Vuel. Remplace la validation **manuelle** des dépôts (boutons
Telegram) par une validation **automatique** — l'admin peut toujours valider
à la main si le monitor ne trouve pas de correspondance (session Wave
expirée, etc.). Les deux coexistent.

## Fichiers ajoutés

- `src/wave-monitor/wave-session.service.ts` — connexion au compte Wave
  Business (API GraphQL interne, comme l'appli mobile Wave Business) : PIN →
  OTP → session persistée, lecture des paiements reçus du jour.
- `src/wave-monitor/wave-monitor.service.ts` — boucle toutes les 30 s
  (`@Interval`) : compare les paiements Wave reçus aux dépôts `PENDING` en
  base (match **montant + numéro payeur**), crédite via
  `WalletService.approveDeposit()` (méthode déjà existante, réutilisée telle
  quelle), notifie Telegram.
- `src/wave-monitor/wave-monitor-admin.controller.ts` — endpoints admin :
  - `GET  /admin/wave-monitor/status`
  - `POST /admin/wave-monitor/config` `{ enabled, businessPhone, businessPin, deviceId }`
  - `POST /admin/wave-monitor/login` (étape 1 — envoie l'OTP par SMS)
  - `POST /admin/wave-monitor/otp` `{ otp }` (étape 2 — ouvre la session)
- `src/wave-monitor/dto/wave-monitor-config.dto.ts`
- `src/wave-monitor/wave-monitor.module.ts`
- `prisma/migrations/20260919000000_wave_monitor/migration.sql` — nouveaux
  champs sur `PaymentConfig` (identifiants Wave Business + session) et
  nouvelle table `WaveSeenTransaction` (anti-doublon persistant).
- `pwa/admin.html` — nouvel écran **🌊 Wave Monitor** dans le back-office :
  configurer le numéro/PIN/deviceId, se connecter (PIN → SMS OTP), activer/
  désactiver la validation automatique — tout depuis le site, sans Postman.

## Fichiers modifiés

- `prisma/schema.prisma` — ajouts sur `PaymentConfig` + modèle
  `WaveSeenTransaction`.
- `src/app.module.ts` — ajout de `ScheduleModule.forRoot()` (requis par
  `@Interval`) et import de `WaveMonitorModule`.
- `package.json` — ajout de `@nestjs/schedule`.

## Côté app mobile (déjà en place, aucun changement nécessaire)

`wallet_tab.dart` demande déjà au joueur son numéro Wave avant d'ouvrir le
lien de paiement (`_promptWavePhoneNumber`), et ce numéro est envoyé au
back-end (`DepositDto.phoneNumber` → `Transaction.payerPhone`). C'est ce
même numéro que le Wave Monitor utilise maintenant pour matcher
automatiquement le paiement reçu.

## Mise en route

1. `npm install` (ajoute `@nestjs/schedule`), puis `npx prisma migrate deploy`.
2. Ouvre le back-office (`pwa/admin.html`) → **🌊 Wave Monitor** :
   - Renseigne le numéro et le PIN du compte Wave Business (+ éventuellement
     un `deviceId` fixe), puis **Enregistrer**.
   - **Se connecter (envoyer le code SMS)** → un SMS OTP arrive sur le
     numéro Wave Business.
   - Saisis le code reçu puis **Valider le code** → la session s'ouvre.
   - Coche **Activer la validation automatique des dépôts Wave**.
3. La session Wave dure ~20h ; si elle expire, un message Telegram alerte
   l'admin (au plus une alerte / 30 min) et il faut refaire connexion → OTP
   depuis ce même écran.

## À savoir

- Ceci utilise l'API GraphQL **interne** de Wave Business (celle de l'appli
  mobile), pas une API partenaire officielle documentée par Wave — c'est
  exactement le même principe que l'outil `wave-monitor` fourni, juste porté
  dans le back-end Vuel. À garder en tête côté conditions d'utilisation Wave,
  et à surveiller si Wave fait évoluer ce format (le monitor loggue et alerte
  Telegram en cas d'erreur d'authentification/session).
- Tout se pilote maintenant depuis le back-office (`pwa/admin.html` →
  🌊 Wave Monitor) — plus besoin de Postman/curl pour la config, la
  connexion Wave ou l'activation.

## Connexion via navigateur distant (alternative au PIN dans le back-office)

Pour éviter de stocker le PIN Wave Business dans la base et de rejouer
l'appel GraphQL nous-mêmes (section ci-dessus), un second mode de connexion
a été ajouté : l'admin se connecte **directement sur la vraie page
business.wave.com**, affichée en direct dans le back-office via un Chromium
headless piloté côté serveur (Playwright) ; dès qu'une réponse GraphQL de la
page laisse deviner une session active, le serveur capture les cookies tout
seul.

### Fichiers ajoutés

- `src/wave-monitor/wave-remote-browser.service.ts` — lance un Chromium
  headless (import paresseux de `playwright`), navigue vers
  `https://business.wave.com/`, diffuse des images de l'écran (CDP
  `Page.startScreencast`), relaie clics/frappes via `page.mouse`/`page.keyboard`,
  et capture les cookies (`context.cookies()`) dès qu'une réponse GraphQL de
  la page contient un id de portefeuille — ou manuellement via
  `captureNow()`. Se ferme tout seul après 10 min sans connexion.
- `src/wave-monitor/wave-remote-browser.gateway.ts` — namespace socket.io
  `wave-remote` (réservé ADMIN, vérifié à la main sur le token JWT du
  handshake comme `DuelRoomGateway`) : diffuse les images au back-office et
  relaie ses événements souris/clavier/`confirm_login`/`stop`.
- `pwa/admin.html` — section "Alternative : connexion via navigateur
  distant" dans l'écran 🌊 Wave Monitor : image live + boutons
  Démarrer/Confirmer/Fermer, connectés en socket.io au namespace ci-dessus.

### ⚠️ À vérifier avant la première utilisation réelle

1. **Nom du cookie de session** : on ignore, sans avoir testé une vraie
   connexion, si `business.wave.com` pose un cookie nommé `sId` (comme
   l'API mobile déjà gérée par `WaveSessionService`) ou un autre nom. Le
   service cherche `sId` en priorité pour rester compatible tel quel, mais
   garde **tous** les cookies capturés dans le nouveau champ
   `PaymentConfig.waveRemoteCookiesRaw` en secours — à regarder en base après
   la première connexion si `getTodayIncomingPayments()` ne trouve rien.
2. **Dépendance Playwright** : `npm install` télécharge maintenant Chromium
   via le script `postinstall` (`playwright install --with-deps chromium`,
   ~300 Mo) — vérifier que l'hébergeur (ex. Render) a assez d'espace disque
   au build, et que le plan a assez de RAM pour faire tourner un Chromium
   headless en plus du reste (prévoir au moins 512 Mo dédiés rien qu'à ça).
3. **Conditions d'utilisation Wave** : cette méthode fait interagir un
   navigateur automatisé avec le vrai site business.wave.com (pas juste
   l'API interne comme la section précédente) — même remarque que
   ci-dessus sur les CGU Wave, à surveiller côté produit/juridique.

## Connexion locale via VS Code (le plus simple en dev)

Troisième option, la plus simple si tu développes en local : un script
autonome qui ouvre un vrai Chromium **visible** directement sur ton écran
(pas besoin du streaming websocket ci-dessus, puisque le navigateur tourne
sur ta propre machine) et enregistre la session directement dans la base
pointée par `DATABASE_URL` (ton `.env`).

### Fichiers ajoutés

- `scripts/capture-wave-session.ts` — ouvre Chromium (`headless: false`) sur
  `business.wave.com`, capture les cookies dès qu'une réponse GraphQL révèle
  un id de portefeuille (même logique que `WaveRemoteBrowserService`), avec
  un filet de secours (appuyer sur Entrée dans le terminal) si la détection
  auto ne se déclenche pas.
- `package.json` — script `npm run wave:capture-session`.
- `.vscode/launch.json` (à la racine du dépôt, pas dans `backend/`) — deux
  configurations prêtes pour l'onglet **Exécuter et déboguer** de VS Code :
  **"Capturer session Wave (navigateur visible)"** et **"Lancer le serveur
  (start:dev)"**. Sélectionne l'une d'elles dans le menu déroulant en haut du
  panneau, puis F5.

### Utilisation

1. Onglet **Exécuter et déboguer** (icône ▷🐞 dans la barre latérale, ou
   `Ctrl+Maj+D`) → choisis **"Capturer session Wave (navigateur visible)"**
   dans le menu déroulant en haut → F5 (ou clic sur ▷).
2. Une vraie fenêtre Chromium s'ouvre sur ton écran, déjà sur la page Wave
   Business. Connecte-toi normalement (PIN + code SMS).
3. La session est enregistrée automatiquement dès que la connexion réussit —
   un message apparaît dans le terminal intégré de VS Code. Si rien ne se
   passe après connexion, reviens dans ce terminal et appuie sur Entrée pour
   forcer la capture.
4. Démarre (ou redémarre) le serveur normalement — `npm run start:dev` (ou
   la config **"Lancer le serveur (start:dev)"**) — il relit la session
   depuis la base au prochain cycle de `WaveMonitorService` (toutes les
   30 s), pas besoin de le relancer si les deux tournent déjà en même temps.

Nécessite `npm install` fait au moins une fois (installe `playwright`,
`dotenv` et télécharge Chromium via le `postinstall`, cf. section
précédente).
