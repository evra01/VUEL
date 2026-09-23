#!/usr/bin/env bash
set -euo pipefail

# Génère un projet Flutter complet (flutter create) puis superpose le code Vuel
# (lib/, natif Android/Kotlin, natif iOS/Swift) par-dessus. Le dossier généré
# (mobile/app) n'est PAS versionné : il est reconstruit à chaque run CI et à
# chaque exécution locale, pour toujours matcher la version de Flutter installée.
#
# Usage : ./scripts/bootstrap.sh   (depuis mobile/, ou n'importe où — le script
# se repère lui-même par rapport à son propre emplacement)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERLAY_DIR="$ROOT_DIR/vuel_overlay"
APP_DIR="$ROOT_DIR/app"
ORG="com.vuel"
NAME="app" # avec ORG=com.vuel → applicationId "com.vuel.app", attendu par le code Kotlin/Dart

command -v flutter >/dev/null 2>&1 || { echo "Flutter SDK introuvable sur le PATH." >&2; exit 1; }

echo "→ flutter create"
rm -rf "$APP_DIR"
flutter create --org "$ORG" --project-name "$NAME" --platforms android,ios "$APP_DIR" >/dev/null

echo "→ Dart : lib/ et pubspec.yaml"
rm -rf "$APP_DIR/lib"
cp -r "$OVERLAY_DIR/lib" "$APP_DIR/lib"
cp "$OVERLAY_DIR/pubspec.yaml" "$APP_DIR/pubspec.yaml"

echo "→ Assets (logos)"
mkdir -p "$APP_DIR/assets"
cp -r "$OVERLAY_DIR/assets/." "$APP_DIR/assets/"

echo "→ Android : code natif de la bulle flottante"
mkdir -p "$APP_DIR/android/app/src/main/kotlin/com/vuel/app"
cp "$OVERLAY_DIR/android_overlay/kotlin/com/vuel/app/"*.kt \
   "$APP_DIR/android/app/src/main/kotlin/com/vuel/app/"
cp "$OVERLAY_DIR/android_overlay/MainActivity.kt" \
   "$APP_DIR/android/app/src/main/kotlin/com/vuel/app/MainActivity.kt"

echo "→ Android : ressources visuelles de la bulle (layout, anneau, logo)"
mkdir -p "$APP_DIR/android/app/src/main/res/layout" "$APP_DIR/android/app/src/main/res/drawable"
cp "$OVERLAY_DIR/android_overlay/res/layout/"*.xml "$APP_DIR/android/app/src/main/res/layout/"
cp "$OVERLAY_DIR/android_overlay/res/drawable/"* "$APP_DIR/android/app/src/main/res/drawable/"

MANIFEST="$APP_DIR/android/app/src/main/AndroidManifest.xml"
PERMISSIONS_FILE="$OVERLAY_DIR/android_overlay/AndroidManifest_permissions.xml"
SERVICE_FILE="$OVERLAY_DIR/android_overlay/AndroidManifest_service.xml"

# Insère les <uses-permission> juste après la balise <manifest ...>
awk -v permfile="$PERMISSIONS_FILE" '
  /<manifest/ && !done { print; while ((getline line < permfile) > 0) print line; done=1; next }
  { print }
' "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"

# Insère la déclaration du <service> juste avant </application>
awk -v svcfile="$SERVICE_FILE" '
  /<\/application>/ { while ((getline line < svcfile) > 0) print line }
  { print }
' "$MANIFEST" > "$MANIFEST.tmp" && mv "$MANIFEST.tmp" "$MANIFEST"

# Flutter récent génère build.gradle.kts (Kotlin DSL) par défaut, plutôt que
# l'ancien build.gradle (Groovy) — on détecte lequel existe réellement pour ne
# pas créer un second fichier de build parasite qui casse la détection du
# projet Gradle par Flutter.
APP_BUILD_GRADLE="$APP_DIR/android/app/build.gradle.kts"
[ -f "$APP_BUILD_GRADLE" ] || APP_BUILD_GRADLE="$APP_DIR/android/app/build.gradle"
cat "$OVERLAY_DIR/android_overlay/build_gradle_additions.txt" >> "$APP_BUILD_GRADLE"

echo "→ iOS : détection de screenshot"
cp "$OVERLAY_DIR/ios_overlay/ScreenshotWatcherPlugin.swift" \
   "$APP_DIR/ios/Runner/ScreenshotWatcherPlugin.swift"
cp "$OVERLAY_DIR/ios_overlay/AppDelegate.swift" \
   "$APP_DIR/ios/Runner/AppDelegate.swift"

PLIST="$APP_DIR/ios/Runner/Info.plist"
PLIST_ADD_FILE="$OVERLAY_DIR/ios_overlay/Info_plist_additions.xml"
# Insère les clés juste avant le premier </dict> (le plist par défaut n'a qu'un
# seul dict de premier niveau — si des CFBundleURLTypes sont ajoutés plus tard,
# revérifier cette hypothèse).
awk -v addfile="$PLIST_ADD_FILE" '
  /<\/dict>/ && !done { while ((getline line < addfile) > 0) print line; print; done=1; next }
  { print }
' "$PLIST" > "$PLIST.tmp" && mv "$PLIST.tmp" "$PLIST"

echo "→ flutter pub get"
(cd "$APP_DIR" && flutter pub get)

echo "→ Icône de l'app (remplace l'icône Flutter par défaut par le logo Vuel)"
(cd "$APP_DIR" && dart run flutter_launcher_icons)

echo "→ Notifications push (FCM) : google-services.json + plugin Gradle"
GOOGLE_SERVICES_SRC="$OVERLAY_DIR/google-services.json"
if [ -f "$GOOGLE_SERVICES_SRC" ]; then
  cp "$GOOGLE_SERVICES_SRC" "$APP_DIR/android/app/google-services.json"

  # Le plugin Gradle "google-services" n'est ajouté QUE si google-services.json
  # est présent : l'appliquer sans ce fichier casse tout build Android avec
  # l'erreur "File google-services.json is missing" — c'est pour ça que ce
  # bloc entier est dans le `if`, jamais exécuté par défaut.
  SETTINGS_GRADLE="$APP_DIR/android/settings.gradle.kts"
  [ -f "$SETTINGS_GRADLE" ] || SETTINGS_GRADLE="$APP_DIR/android/settings.gradle"
  GSERVICES_VERSION="4.5.0"

  if [[ "$SETTINGS_GRADLE" == *.kts ]]; then
    # Repère la dernière ligne connue et stable du bloc `plugins {}` généré par
    # `flutter create` (id("org.jetbrains.kotlin.android") ...) et insère notre
    # ligne juste après — plus robuste que de viser une accolade fermante, qui
    # apparaît aussi ailleurs dans le fichier.
    if grep -q "com.google.gms.google-services" "$SETTINGS_GRADLE"; then
      : # déjà ajouté par un run précédent (le dossier android/ vient d'être
        # régénéré à neuf par `flutter create` ci-dessus, donc ce cas normalement
        # ne se produit jamais, mais on reste idempotent par précaution).
    elif grep -q 'id("org.jetbrains.kotlin.android")' "$SETTINGS_GRADLE"; then
      awk -v v="$GSERVICES_VERSION" '
        { print }
        /id\("org\.jetbrains\.kotlin\.android"\)/ {
          print "    id(\"com.google.gms.google-services\") version \"" v "\" apply false"
        }
      ' "$SETTINGS_GRADLE" > "$SETTINGS_GRADLE.tmp" && mv "$SETTINGS_GRADLE.tmp" "$SETTINGS_GRADLE"
    else
      echo "  ⚠️  settings.gradle.kts a un format inattendu — ajoute le plugin à la main (voir PUSH_SETUP.md)."
    fi

    if grep -q "com.google.gms.google-services" "$APP_BUILD_GRADLE" 2>/dev/null; then
      :
    elif grep -q 'id("kotlin-android")' "$APP_BUILD_GRADLE"; then
      awk '
        { print }
        /id\("kotlin-android"\)/ { print "    id(\"com.google.gms.google-services\")" }
      ' "$APP_BUILD_GRADLE" > "$APP_BUILD_GRADLE.tmp" && mv "$APP_BUILD_GRADLE.tmp" "$APP_BUILD_GRADLE"
      echo "  → plugin google-services activé automatiquement (Gradle Kotlin DSL)."
    else
      echo "  ⚠️  app/build.gradle.kts a un format inattendu — ajoute le plugin à la main (voir PUSH_SETUP.md)."
    fi
  else
    # Ancien format Groovy (build.gradle classique) — mêmes principes,
    # ancrés sur des lignes que `flutter create` y génère toujours.
    ROOT_BUILD_GRADLE="$APP_DIR/android/build.gradle"
    if grep -q "com.google.gms:google-services" "$ROOT_BUILD_GRADLE" 2>/dev/null; then
      :
    elif grep -q "classpath 'com.android.tools.build:gradle" "$ROOT_BUILD_GRADLE"; then
      awk -v v="$GSERVICES_VERSION" '
        { print }
        /classpath .com\.android\.tools\.build:gradle/ { print "        classpath \x27com.google.gms:google-services:" v "\x27" }
      ' "$ROOT_BUILD_GRADLE" > "$ROOT_BUILD_GRADLE.tmp" && mv "$ROOT_BUILD_GRADLE.tmp" "$ROOT_BUILD_GRADLE"
    else
      echo "  ⚠️  android/build.gradle a un format inattendu — ajoute le plugin à la main (voir PUSH_SETUP.md)."
    fi
    if ! grep -q "com.google.gms.google-services" "$APP_BUILD_GRADLE" 2>/dev/null; then
      echo "apply plugin: 'com.google.gms.google-services'" >> "$APP_BUILD_GRADLE"
      echo "  → plugin google-services activé automatiquement (Gradle Groovy)."
    fi
  fi
else
  echo "  (google-services.json absent — dépose-le dans mobile/vuel_overlay/ pour"
  echo "   activer FCM au prochain bootstrap. Voir PUSH_SETUP.md.)"
fi

echo "Terminé — projet prêt dans $APP_DIR"
