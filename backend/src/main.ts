import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  // Sert la PWA joueur (pwa/index.html, manifest.json, sw.js, icons/) sous
  // /app — utilisé comme repli quand le lien d'invitation d'un salon (cf.
  // DuelInviteController) ne parvient pas à ouvrir l'app native (pas
  // installée) : on redirige alors vers /app/?join=<code> plutôt que de
  // laisser le visiteur bloqué avec un code à recopier à la main. `pwa/` est
  // un dossier frère de `backend/` dans le dépôt — ce chemin relatif marche
  // tant que le service déployé garde cette arborescence (Render clone tout
  // le dépôt même quand le "Root Directory" est backend/, donc pwa/ existe
  // bien à côté sur le disque). Si la PWA est hébergée ailleurs (Vercel,
  // Netlify...), définir PWA_URL fait passer outre ce service statique (cf.
  // DuelInviteController).
  app.useStaticAssets(join(__dirname, '..', '..', 'pwa'), { prefix: '/app' });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
