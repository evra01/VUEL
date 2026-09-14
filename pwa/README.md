# Vuel — PWA

Application web installable (Progressive Web App), branchée sur le vrai back-end
NestJS — plus de données de démo, tout passe par l'API réelle (auth OTP, wallet,
duels en temps réel via WebSocket, tournois).

## Lancer en local

Un service worker ne fonctionne pas ouvert directement en `file://` — il faut un
petit serveur HTTP. Depuis ce dossier :

```bash
cd pwa
python3 -m http.server 8080
# ou : npx serve .
```

Ouvre `http://localhost:8080`. Au premier lancement, tape l'icône ⚙️ (écran de
connexion ou Profil) pour vérifier/ajuster l'adresse de l'API — par défaut
`http://localhost:3000`, ce qui correspond au back-end lancé en suivant
[`../TESTING.md`](../TESTING.md).

## Installer comme app

Dans Chrome/Edge sur desktop ou Android : icône d'installation dans la barre
d'adresse (ou menu ⋮ → "Installer l'application"). Sur iOS Safari : bouton
Partager → "Sur l'écran d'accueil". En local (`localhost`), l'installation
fonctionne sans HTTPS — en production, un vrai certificat HTTPS est obligatoire
pour que le navigateur propose l'installation.

## Ce qui est branché sur le vrai back-end

- Inscription (OTP), connexion, déconnexion
- Profil, IDs de jeu, choix d'icône d'avatar
- Wallet : solde, historique, dépôt (ouvre le vrai lien Wave), retrait
- Jouer : liste des duels ouverts, création, inscription
- **Salon de duel en temps réel** : socket.io-client connecté au même WebSocket
  que l'app mobile (`DuelRoomGateway`) — échange d'IDs, chat, Prêt/Lancer
- Envoi de preuve (capture d'écran) via upload de fichier classique — pas de bulle
  flottante ni de détection automatique de screenshot ici, ce sont des
  fonctionnalités natives Android/iOS (cf. `mobile/`), pas possibles dans un
  navigateur
- Tournois : liste, création, inscription, démarrage, annulation (remboursement)

## Limites connues

- **Pas de notifications push** — nécessiterait Firebase Cloud Messaging côté web
  (Web Push), non branché pour l'instant
- **Capture manuelle uniquement** — sur mobile natif, la bulle flottante Android
  capture automatiquement l'écran ; ici il faut sélectionner un fichier à la main
- **Pas de mode hors-ligne pour les données** — le service worker met en cache le
  "shell" de l'app (HTML/icônes) pour un chargement instantané et une installation
  possible, mais les appels API nécessitent toujours une connexion (aucune
  synchronisation différée pour l'instant)
- **CORS** : le back-end autorise toutes les origines par défaut
  (`app.enableCors()` sans restriction dans `main.ts`) — à restreindre à ton vrai
  domaine avant la mise en prod

## Structure

```
pwa/
├── index.html      Toute l'app (une seule page, navigation en JS pur, pas de framework)
├── manifest.json    Nom, icônes, couleurs — rend l'app installable
├── sw.js            Service worker : cache le shell, laisse passer les appels API
└── icons/           Générées à partir du logo Vuel (standard + "maskable")
```
