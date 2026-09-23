import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { DuelsService } from './duels.service';

/// Contrôleur PUBLIC (pas de JwtAuthGuard) — sert la page ouverte quand un
/// joueur partage le lien d'invitation de son salon à un ami (cf. bouton
/// "Partager" dans DuelRoomScreen côté mobile). Un ami qui clique ce lien n'a
/// pas forcément l'app installée ni de session valide, donc cette route ne
/// peut pas être protégée par le même guard que le reste de l'API duels.
///
/// La page tente d'ouvrir l'app via le schéma personnalisé `vuel://`, et
/// affiche sinon le code du salon à copier-coller dans l'app (écran "Jouer"
/// > "Rejoindre avec un code") — cf. PlayTab côté mobile.
@Controller('d')
export class DuelInviteController {
  constructor(private duelsService: DuelsService) {}

  @Get(':code')
  async invite(@Param('code') code: string, @Res() res: Response) {
    let preview:
      | { id: string; joinCode: string | null; game: string; mode: string; stakeAmount: number; status: string; creatorPseudo: string }
      | null = null;
    try {
      preview = await this.duelsService.getPublicPreview(code);
    } catch {
      preview = null;
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderInvitePage(code, preview));
  }
}

const GAME_LABELS: Record<string, string> = {
  EFOOTBALL: 'eFootball',
  CODM: 'Call of Duty Mobile',
  LUDO: 'Ludo',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderInvitePage(
  requestedCode: string,
  preview: { id: string; joinCode: string | null; game: string; mode: string; stakeAmount: number; status: string; creatorPseudo: string } | null,
): string {
  // Toujours afficher/partager le code court du salon (joinCode) plutôt que
  // l'UUID technique — même pour un lien ouvert via l'ancien format /d/:id
  // (repli sur requestedCode si le duel n'a pas encore de joinCode, cf.
  // migration des duels créés avant son ajout).
  const displayCode = escapeHtml(preview?.joinCode ?? requestedCode);
  const deepLink = `vuel://duel/${displayCode}`;

  // Repli PWA quand l'app native ne s'ouvre pas (pas installée) : PWA_URL
  // permet de pointer vers une PWA hébergée ailleurs (Vercel, Netlify...) ;
  // par défaut on utilise /app, servi par ce même serveur (cf. main.ts).
  const pwaBase = (process.env.PWA_URL || '/app').replace(/\/$/, '');
  const fallbackUrl = `${pwaBase}/?join=${encodeURIComponent(displayCode)}`;

  const body = preview
    ? `
      <p class="pseudo">${escapeHtml(preview.creatorPseudo)} t'invite à un duel</p>
      <h1>${escapeHtml(GAME_LABELS[preview.game] ?? preview.game)}</h1>
      <p class="stake">💰 Mise : ${preview.stakeAmount} F</p>
      ${preview.status !== 'OPEN' ? '<p class="warn">⚠️ Ce salon n\'est plus ouvert — il a peut-être déjà démarré ou été annulé.</p>' : ''}
    `
    : `<p class="warn">⚠️ Ce salon n'existe pas ou n'est plus disponible.</p>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rejoindre un duel — Vuel</title>
<style>
  body { font-family: -apple-system, Roboto, Arial, sans-serif; background: #0f1115; color: #f4f4f5; margin: 0; padding: 32px 20px; text-align: center; }
  .card { max-width: 380px; margin: 0 auto; background: #17191f; border-radius: 16px; padding: 28px 20px; }
  .pseudo { color: #a1a1aa; font-size: 13px; margin: 0 0 4px; }
  h1 { font-size: 24px; margin: 0 0 12px; }
  .stake { color: #fbbf24; font-weight: 600; }
  .warn { color: #f87171; font-size: 13px; }
  .code-box { margin-top: 20px; background: #0f1115; border: 1px dashed #3f3f46; border-radius: 10px; padding: 12px; }
  .code-label { font-size: 11px; color: #a1a1aa; margin: 0 0 6px; }
  .code { font-size: 22px; letter-spacing: 3px; font-family: monospace; color: #fbbf24; }
  .copy-btn { margin-top: 10px; background: #27272a; color: #f4f4f5; border: 1px solid #3f3f46; border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; }
  .copy-btn:active { opacity: 0.7; }
  .btn { display: block; margin-top: 20px; background: #fbbf24; color: #1c1206; text-decoration: none; font-weight: 700; padding: 12px; border-radius: 10px; }
  .btn-secondary { display: block; margin-top: 10px; background: transparent; color: #f4f4f5; text-decoration: underline; font-weight: 500; padding: 6px; border-radius: 10px; font-size: 13px; }
  .hint { font-size: 12px; color: #a1a1aa; margin-top: 14px; line-height: 1.5; }
</style>
</head>
<body>
  <div class="card">
    ${body}
    <a class="btn" href="${deepLink}">Ouvrir dans l'app Vuel</a>
    <a class="btn-secondary" href="${fallbackUrl}">Continuer sur le site (sans l'app)</a>
    <div class="code-box">
      <p class="code-label">App pas installée, ou le lien ne s'ouvre pas tout seul ?<br/>Dans Vuel, va dans "Jouer" → "Rejoindre avec un code" et colle :</p>
      <p class="code" id="joinCodeText">${displayCode}</p>
      <button type="button" class="copy-btn" id="copyCodeBtn" onclick="copyJoinCode()">Copier le code</button>
    </div>
    <p class="hint">Vuel est un jeu d'argent entre amis — rejoins uniquement les salons de personnes que tu connais.</p>
  </div>
  <script>
    // Tente d'ouvrir l'app native, et bascule automatiquement sur le site
    // (PWA) si ça ne marche pas (app pas installée) — au lieu de laisser le
    // visiteur bloqué avec juste un code à recopier à la main. Le
    // <meta http-equiv="refresh"> utilisé avant ne permettait pas ce repli :
    // il tentait le deep link sans aucun moyen de détecter l'échec.
    (function () {
      var fallbackUrl = ${JSON.stringify(fallbackUrl)};
      var deepLink = ${JSON.stringify(deepLink)};
      var redirected = false;

      function goFallback() {
        if (redirected) return;
        redirected = true;
        window.location.href = fallbackUrl;
      }

      // Si l'app s'ouvre effectivement, la page passe en arrière-plan (ou se
      // décharge) — on annule le repli pour ne pas rouvrir le navigateur
      // par-dessus l'app une fois l'utilisateur revenu dessus.
      document.addEventListener('visibilitychange', function () {
        if (document.hidden) redirected = true;
      });
      window.addEventListener('pagehide', function () { redirected = true; });

      window.location.href = deepLink;
      // 1.2s : assez long pour laisser le temps au système de basculer vers
      // l'app si elle est installée, assez court pour ne pas laisser
      // l'utilisateur poireauter sur une page blanche si elle ne l'est pas.
      setTimeout(goFallback, 1200);
    })();

    // Copie le code affiché ci-dessus, pour ne pas obliger à le sélectionner
    // à la main (fastidieux sur mobile, surtout pour un UUID de repli — cf.
    // displayCode côté serveur). navigator.clipboard exige un contexte
    // sécurisé (https) : cette page l'est toujours en usage réel, mais on
    // garde un repli execCommand pour ne pas planter silencieusement sinon.
    function copyJoinCode() {
      var text = document.getElementById('joinCodeText').textContent;
      var btn = document.getElementById('copyCodeBtn');
      function onCopied() {
        var original = btn.textContent;
        btn.textContent = 'Copié ✓';
        setTimeout(function () { btn.textContent = original; }, 1500);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onCopied).catch(function () { fallbackCopy(text, onCopied); });
      } else {
        fallbackCopy(text, onCopied);
      }
    }
    function fallbackCopy(text, onCopied) {
      var input = document.createElement('textarea');
      input.value = text;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      try { document.execCommand('copy'); onCopied(); } catch (_) {}
      document.body.removeChild(input);
    }
  </script>
</body>
</html>`;
}
