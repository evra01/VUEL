# Vuel

Application mobile d'esport — duels 1v1 eFootball / Call of Duty: Mobile avec mises financières.
Voir le cahier des charges pour la spécification complète.

## Structure du repo

```
vuel/
├── backend/     API NestJS + Prisma (auth, wallet, matchmaking, escrow, OCR, litiges, admin)
│   └── requests.http    Requêtes de test prêtes à l'emploi (extension REST Client)
├── pwa/         Application web installable (PWA) — branchée sur le vrai back-end
├── mobile/      Code Flutter (détection device, salon de duel, capture/OCR par plateforme)
├── .vscode/     Tâches, débogueur et paramètres pour tester directement dans VS Code
├── docker-compose.yml   Postgres + Redis pour le développement local
└── .github/workflows/   CI : build back-end + build Android/iOS
```

## PWA (web)

```bash
cd pwa
python3 -m http.server 8080
```

Ouvre `http://localhost:8080`, configure l'adresse de l'API via l'icône ⚙️ si besoin
(par défaut `http://localhost:3000`). Détails complets : [`pwa/README.md`](pwa/README.md).

## Tester en local avec VS Code

Pour un guide pas à pas avec les commandes exactes à taper dans le terminal (sans
dépendre de VS Code), voir [`TESTING.md`](TESTING.md). La section ci-dessous décrit
l'équivalent via les tâches VS Code.

Le repo contient tout le nécessaire (`.vscode/`, `docker-compose.yml`, `backend/requests.http`).

**Prérequis** : Docker Desktop, Node.js 20+. Pour la partie mobile : le SDK Flutter.
Extensions recommandées (VS Code proposera de les installer à l'ouverture du dossier) :
Prisma, ESLint, Prettier, **REST Client** (humao.rest-client), Docker, Dart/Flutter.

**Étapes** — ouvre la palette de commandes (`Cmd+Shift+P` / `Ctrl+Shift+P`) → `Tasks: Run Task` → :

1. **Docker : démarrer Postgres + Redis**
2. Dans `backend/`, copie `.env.example` vers `.env` (les valeurs par défaut correspondent
   au `docker-compose.yml` fourni, rien à changer pour démarrer)
3. **Backend : installer les dépendances**
4. **Backend : migrer la base (Prisma)**
5. **Backend : créer le premier compte admin** (crée un compte ADMIN via
   `SEED_ADMIN_PHONE`/`SEED_ADMIN_PASSWORD` — modifie ces valeurs dans `.vscode/tasks.json`
   si tu veux un autre numéro/mot de passe)
6. **Backend : lancer en mode debug** (tourne en arrière-plan avec l'inspecteur Node ouvert)
7. Onglet **Run and Debug** → sélectionne **"Backend : Attacher le débogueur"** → lance.
   Tu peux maintenant poser des breakpoints dans le code TypeScript.

**Tester les endpoints** : ouvre `backend/requests.http` et clique sur `Send Request`
au-dessus de chaque requête (l'extension REST Client affiche la réponse dans un panneau
à côté). Le fichier couvre inscription/login, wallet, tournois, et la configuration admin
(Wave, Twilio) — variables `@token` / `@adminToken` à remplir après un login.

⚠️ Pour tester l'inscription, Twilio n'est pas nécessaire : si tu ne configures pas
`PATCH /admin/sms-config`, le code OTP s'affiche directement dans le terminal où tourne
la tâche **Backend : lancer en mode debug** (cherche la ligne commençant par
`[SMS non configuré...]`). Utile pour tester en local ; à retirer avant la prod.

**Mobile (optionnel)** : tâche **Mobile : générer le projet Flutter (bootstrap)**, puis
ouvre `mobile/app` comme dossier dans VS Code (ou utilise la config de lancement
*"Mobile : Flutter"* déjà présente dans `.vscode/launch.json`).

## Back-end

```bash
cd backend
npm install
cp .env.example .env   # renseigner DATABASE_URL, JWT_SECRET, etc.
npx prisma migrate dev --name init
npm run start:dev
```

Détails complets : [`backend/README.md`](backend/README.md).

## Mobile

Le dossier `mobile/vuel_overlay/` contient tout le code propre à Vuel (Dart + natif
Android/iOS). Le projet Flutter complet (`mobile/app/`) est généré à la demande :

```bash
cd mobile
./scripts/bootstrap.sh   # nécessite le SDK Flutter sur le PATH
cd app
flutter run
```

Ce script lance `flutter create`, puis copie/injecte le code de `vuel_overlay/` par-dessus
(lib/, plugin Kotlin de la bulle flottante, plugin Swift de détection de screenshot,
permissions du manifest, dépendance Gradle). `mobile/app/` n'est pas versionné — il est
régénéré à chaque fois pour rester compatible avec la version de Flutter installée.

Détails complets : [`mobile/README.md`](mobile/README.md).

## CI GitHub Actions

Deux workflows, déclenchés uniquement quand le dossier concerné change :

- **`backend-ci.yml`** : `npm install` + `prisma generate` + `npm run build`
- **`mobile-ci.yml`** : lance `bootstrap.sh` puis compile un APK Android (debug) et un
  build iOS non signé, sur les deux OS runners GitHub (`ubuntu-latest` / `macos-latest`)

L'APK compilé est publié comme artifact téléchargeable sur chaque run (onglet Actions
du repo GitHub → run → Artifacts → `vuel-debug-apk`).

## Mettre ce repo sur GitHub

```bash
# 1. Créer un repo vide sur https://github.com/new (ne PAS l'initialiser avec un README)
# 2. Depuis ce dossier :
git remote add origin https://github.com/<ton-compte>/vuel.git
git branch -M main
git push -u origin main
```

Le premier push déclenche automatiquement les deux workflows CI.
