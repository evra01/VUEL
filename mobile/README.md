# Vuel — Mobile (Flutter)

## Structure

```
mobile/
├── vuel_overlay/     Code source réel de Vuel (Dart + natif Android/iOS + assets) — c'est ici qu'on travaille
├── scripts/
│   └── bootstrap.sh  Génère mobile/app/ (flutter create + superposition du code Vuel)
└── app/              Généré par bootstrap.sh — PAS versionné (voir .gitignore)
```

`vuel_overlay/assets/logos/` contient le logo Vuel et les logos des 3 jeux (eFootball, CODM,
Ludo), déclarés dans `pubspec.yaml`. `bootstrap.sh` copie tout `vuel_overlay/` (dont ce
dossier `assets/`) dans le projet généré — les logos sont donc automatiquement inclus.
Accès dans le code via la classe `GameLogos` (`lib/core/assets/game_logos.dart`).

`vuel_overlay/` n'est pas un projet Flutter buildable tel quel : il lui manque tout le
squelette natif généré par `flutter create` (Gradle wrapper, Xcode project, icônes par
défaut, etc.). `scripts/bootstrap.sh` génère ce squelette à la demande avec la version de
Flutter installée, puis copie/injecte le contenu de `vuel_overlay/` par-dessus. C'est aussi
ce que fait le workflow `mobile-ci.yml` sur GitHub Actions.

## Développement local

```bash
cd mobile
./scripts/bootstrap.sh   # nécessite le SDK Flutter sur le PATH
cd app
flutter run
```

Relancer `bootstrap.sh` après chaque modification dans `vuel_overlay/` (il régénère `app/`
à chaque fois — ne jamais éditer directement les fichiers dans `mobile/app/`, ils seront
écrasés).

## Ce qui est fonctionnel

| Fichier | Rôle |
|---|---|
| `device_detector_service.dart` | Détecte OS + marque + modèle via `device_info_plus`, normalise la marque sur la liste du formulaire d'inscription |
| `overlay_permission_service.dart` | Vérifie/ouvre la permission `SYSTEM_ALERT_WINDOW` |
| `battery_optimization_service.dart` | Ouvre l'écran constructeur dédié (Xiaomi/Huawei/Oppo/Realme/Vivo/Samsung/Tecno/Infinix/Itel/Honor) avec repli sur l'écran standard Android |
| `user_api_client.dart` | Envoie les infos device au back-end (`PATCH /users/me`) |
| `brand_tutorials_data.dart` | Contenu textuel des tutoriels par marque (11 marques couvertes) |
| `device_setup_screen.dart` | Écran complet qui enchaîne détection → sync → tutoriel → permissions |
| `duel_room_screen.dart` | Écran salon : cartes joueurs avec IDs échangés auto, chat temps réel, boutons Prêt/Lancer |
| `core/widgets/player_avatar.dart` | Avatar joueur : icône d'app choisie (`AppAvatarIcons`), sinon initiales + couleur déterministe en repli |
| `features/avatar_picker/avatar_picker_screen.dart` | Grille de sélection d'icône — pas de photo, que des icônes fournies par l'app |
| `core/api/wallet_api_client.dart` | Déclenche un dépôt, ouvre le lien de paiement Wave reçu dans le navigateur du téléphone |
| `core/api/tournaments_api_client.dart` | Liste, création, inscription et démarrage de tournois |
| `features/tournaments/tournaments_screen.dart` | Liste des tournois ouverts, création (mise min. 200 F), inscription, démarrage/annulation par l'organisateur |
| `capture/capture_controller.dart` | Démarre automatiquement la capture (bulle Android / watcher iOS) au `duel_started` |
| `android_overlay/kotlin/.../OverlayBubbleService.kt` | Service Android : bulle flottante + capture MediaProjection + upload direct |
| `ios_overlay/ScreenshotWatcherPlugin.swift` | Détecte le screenshot système pendant le duel, notification locale, upload depuis la photothèque |
| `main.dart` | Écran d'accueil de démo listant les modules — à remplacer par le vrai flow d'authentification |

## À compléter

- **Visuels réels** des tutoriels (`imageAsset` sont des placeholders) — dépend des maquettes Figma
- **iOS** : pas d'équivalent overlay, flux notification intelligente utilisé à la place (cf. 3.4 du cahier des charges)
- **Intents constructeur Tecno/Infinix/Itel/Honor** : meilleures estimations, à valider sur appareils physiques (les noms de composants système changent parfois entre versions de firmware)
- **Authentification** : `main.dart` utilise des tokens de démo — à remplacer par le vrai flow OTP + state management (Riverpod/Bloc) une fois choisi
- **Chiffrement des captures** : transport HTTPS uniquement pour l'instant — voir la note dans `CaptureUploader.kt` si un chiffrement applicatif de bout en bout est requis
- **UI de la bulle Android** : layout générique en placeholder — remplacer par un vrai design une fois les assets prêts
- **`bootstrap.sh` / Info.plist** : l'injection suppose un seul `<dict>` de premier niveau dans le `Info.plist` généré par `flutter create` — à revérifier si des clés imbriquées (ex: `CFBundleURLTypes`) sont ajoutées plus tard
- **Wallet après paiement** : le solde ne se met à jour qu'après confirmation du webhook Wave côté back-end — l'écran wallet réel devra rafraîchir le solde au retour au premier plan (ex: `didChangeAppLifecycleState`) plutôt que de supposer le paiement réussi juste après l'ouverture du lien
- **Bracket de tournoi** : `TournamentsScreen` liste les tournois mais n'affiche pas encore l'arbre du bracket ni les matchs individuels du joueur — une fois un tournoi démarré, il faut aller chercher ses `Duel` (via `GET /tournaments/:id`, champ `duels`, filtrés sur `playerAId`/`playerBId === currentUserId`) et les ouvrir dans `DuelRoomScreen` (déjà compatible : le salon fonctionne pour n'importe quel duel, y compris ceux de tournoi)
- Tester le flow MediaProjection sur plusieurs versions d'Android (comportement en arrière-plan variable entre Android 10 et 14+)
