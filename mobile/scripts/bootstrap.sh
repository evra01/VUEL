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

echo "Terminé — projet prêt dans $APP_DIR"
