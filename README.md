# SportAI Pro — Next.js Full-Stack

## Déploiement Vercel (5 minutes)

### 1. Clés API gratuites
- **football-data.org** → https://www.football-data.org/client/register (obligatoire)
- **The Odds API** → https://the-odds-api.com/#get-access (optionnel, cotes bookmakers)

### 2. Déployer
```bash
npm install -g vercel
vercel login
vercel --prod
```
Ou via GitHub : connectez votre repo sur vercel.com

### 3. Variables d'environnement sur Vercel
Settings → Environment Variables :
- `FOOTBALL_DATA_KEY` = votre Auth Token football-data.org
- `ODDS_API_KEY` = votre clé The Odds API (optionnel)

Puis → Redeploy

### 4. C'est en ligne !
Les utilisateurs visitent juste votre URL Vercel. Rien à installer.

## Dev local
```bash
cp .env.example .env.local
# Remplir les clés dans .env.local
npm install && npm run dev
# → http://localhost:3000
```
