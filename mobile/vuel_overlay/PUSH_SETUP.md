# Notifications push (FCM) — app mobile Vuel

Les notifications in-app (cloche, historique) et le Web Push (PWA) fonctionnent
déjà sans rien configurer. Pour que l'**app mobile Flutter** reçoive elle aussi
des notifications système même fermée (comme WhatsApp), il faut un projet
Firebase — gratuit, ~10 minutes, à faire une seule fois.

## 1. Créer le projet Firebase

1. https://console.firebase.google.com → **Ajouter un projet** (n'importe quel
   nom, ex. "Vuel").
2. Une fois le projet créé : **Paramètres du projet** (⚙️) → **Comptes de
   service** → **Générer une nouvelle clé privée**. Un fichier JSON se
   télécharge.
3. Toujours dans **Paramètres du projet** → onglet **Général** → **Ajouter une
   application** → Android → package `com.vuel.app` (c'est le package attendu
   par le code natif, cf. `scripts/bootstrap.sh`) → suivre l'assistant jusqu'au
   téléchargement de `google-services.json`.

## 2. Brancher les deux fichiers

- Colle le contenu **entier** du fichier de compte de service (étape 1.2) dans
  la variable d'environnement du back-end :
  ```
  # backend/.env
  FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account", ...tout le JSON sur une seule ligne...}
  ```
  Astuce pour l'obtenir sur une seule ligne : `cat service-account.json | tr -d '\n'`

- Place `google-services.json` (étape 1.3) directement dans
  `mobile/vuel_overlay/google-services.json`. `scripts/bootstrap.sh` le copie
  automatiquement au bon endroit (`android/app/google-services.json`) à chaque
  génération du projet.

## 3. Activer le plugin Gradle (une seule fois, à la main)

`bootstrap.sh` copie le fichier mais n'édite **pas** les `build.gradle` —
la syntaxe diffère trop selon la version de Flutter pour l'automatiser sans
risquer de casser le build. Deux cas possibles selon ce que génère ta version
de Flutter (regarde à quoi ressemble `android/settings.gradle.kts` après un
premier `./scripts/bootstrap.sh`) :

**Flutter récent (fichiers `.kts`, bloc `plugins { }` dans `settings.gradle.kts`)**
— le cas le plus probable en 2025+ :

Dans `android/settings.gradle.kts`, dans le bloc `plugins { }` déjà présent,
ajoute une ligne :
```kotlin
plugins {
    // ... lignes existantes (dev.flutter.flutter-plugin-loader, com.android.application, etc.)
    id("com.google.gms.google-services") version "4.5.0" apply false
}
```
Dans `android/app/build.gradle.kts`, dans le bloc `plugins { }` déjà présent :
```kotlin
plugins {
    // ... lignes existantes (com.android.application, kotlin-android, etc.)
    id("com.google.gms.google-services")
}
```

**Flutter plus ancien (fichiers `.gradle` classiques, style `buildscript`)** :

Dans `android/build.gradle`, dans `buildscript { dependencies { ... } }` :
```groovy
classpath 'com.google.gms:google-services:4.5.0'
```
Dans `android/app/build.gradle`, tout en bas du fichier :
```groovy
apply plugin: 'com.google.gms.google-services'
```

Comme `android/` est régénéré à chaque `bootstrap.sh` (il n'est pas versionné,
cf. le commentaire en tête du script), cette étape 3 est à refaire après
chaque run — ou alors versionne `android/` toi-même une fois que le reste
(bulle flottante, icônes) est stable, et retire le `rm -rf "$APP_DIR"` du
script.

## 4. Vérifier

Une fois l'app relancée sur un vrai appareil (le simulateur iOS et l'émulateur
Android sans Google Play Services ne reçoivent pas de vrais push FCM) :
connecte-toi, mets l'app en arrière-plan ou ferme-la, puis déclenche une
notification côté back-end (ex. valide un dépôt depuis le back-office admin)
— la notification système doit apparaître.

Si rien n'apparaît : regarde les logs du back-end au démarrage — un warning
`FIREBASE_SERVICE_ACCOUNT_JSON absent` ou une erreur `FIREBASE_SERVICE_ACCOUNT_JSON
invalide` indique que l'étape 2 n'est pas correcte.

## iOS (bonus, non prioritaire)

FCM sur iOS nécessite en plus une clé APNs (Apple, compte développeur payant)
téléversée dans la console Firebase (**Paramètres du projet → Cloud
Messaging → Configuration Apple**). Sans ça, le code compile et fonctionne
normalement sur Android ; iOS ne recevra simplement aucun push tant que cette
clé n'est pas ajoutée.
