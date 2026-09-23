# Tester Vuel — étape par étape, terminal uniquement

Aucun outil externe requis (pas de Postman, pas d'extension VS Code) — juste `curl` et
`python3` (déjà installé sur mac/Linux, utilisé ici uniquement pour extraire un champ
JSON de la réponse).

## 0. Prérequis

- Docker installé et démarré
- Node.js 20+

## 1. Démarrer Postgres + Redis

```bash
cd vuel
docker compose up -d
```

## 2. Démarrer le back-end (garde ce terminal ouvert — l'OTP s'y affichera)

```bash
cd backend
cp .env.example .env
npm install
npx prisma migrate dev --name init
npm run start:debug
```

Attends de voir `Nest application successfully started` avant de continuer.

## 3. Ouvre un DEUXIÈME terminal pour la suite

Tout ce qui suit se tape dans ce nouveau terminal, à la racine `vuel/backend`.

### 3.1 Créer le premier compte admin

```bash
cd vuel/backend
SEED_ADMIN_PHONE=+22500000000 SEED_ADMIN_PASSWORD=change-me npm run seed:admin
```

### 3.2 Récupérer un token admin

```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+22500000000","password":"change-me"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

echo $ADMIN_TOKEN
```

Si `echo` affiche bien une longue chaîne (le JWT), c'est bon.

## 4. Inscrire un joueur de test

### 4.1 Démarrer l'inscription

```bash
curl -s -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"phone":"+2250700000001","pseudo":"testeur_vuel","password":"motdepasse123"}'
```

### 4.2 Récupérer le code OTP

Retourne dans le **premier terminal** (celui qui fait tourner le back-end) et cherche
une ligne comme :

```
[SMS non configuré — affiché ici pour le dev] → +2250700000001 : Votre code Vuel : 384719
```

Note les 6 chiffres à la fin (`384719` dans cet exemple).

### 4.3 Valider l'OTP et récupérer le token du joueur

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phone":"+2250700000001","code":"REMPLACE_PAR_LE_CODE_RECU"}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['accessToken'])")

echo $TOKEN
```

Si ça affiche une longue chaîne, le compte est créé et tu es connecté.

## 5. Tester le profil

```bash
curl -s http://localhost:3000/users/me -H "Authorization: Bearer $TOKEN"
```

### Ajouter un ID de jeu

```bash
curl -s -X POST http://localhost:3000/users/me/gaming-ids \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"game":"EFOOTBALL","gamePseudo":"MonPseudoEFootball"}'
```

### Choisir une icône d'avatar

```bash
curl -s -X PATCH http://localhost:3000/users/me/avatar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"avatarId":"trophy"}'
```

## 6. Tester le wallet

```bash
curl -s http://localhost:3000/wallet -H "Authorization: Bearer $TOKEN"
```

Le dépôt via Wave échouera tant que la clé API n'est pas configurée (normal, message
d'erreur clair attendu) :

```bash
curl -s -X POST http://localhost:3000/wallet/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":5000}'
```

### Configurer Wave (avec le compte admin)

```bash
curl -s -X PATCH http://localhost:3000/admin/payment-config \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"waveApiKey":"TA_CLE_WAVE","webhookSharedSecret":"un-secret-fort"}'
```

Puis retente le dépôt du wallet ci-dessus — tu devrais recevoir `paymentUrl`.

## 7. Tester les tournois

### Créer un tournoi (mise minimum 200 F)

```bash
TOURNAMENT_ID=$(curl -s -X POST http://localhost:3000/tournaments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Tournoi Test","game":"EFOOTBALL","stakeAmount":200,"maxParticipants":4}' \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")

echo $TOURNAMENT_ID
```

### Lister les tournois ouverts

```bash
curl -s http://localhost:3000/tournaments
```

### Rejoindre (nécessite un solde suffisant — dépose d'abord via Wave, section 6)

```bash
curl -s -X POST http://localhost:3000/tournaments/$TOURNAMENT_ID/join \
  -H "Authorization: Bearer $TOKEN"
```

## 8. Tester le back-office admin

```bash
curl -s http://localhost:3000/admin/stats -H "Authorization: Bearer $ADMIN_TOKEN"
curl -s http://localhost:3000/admin/users -H "Authorization: Bearer $ADMIN_TOKEN"
```

## Pour tout rejouer depuis zéro

```bash
docker compose down -v   # supprime aussi les données Postgres/Redis
docker compose up -d
cd backend && npx prisma migrate dev --name init
```
