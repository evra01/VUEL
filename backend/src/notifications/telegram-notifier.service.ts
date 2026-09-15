import { Injectable, Logger } from '@nestjs/common';

/// Envoie chaque capture d'écran reçue directement vers un chat/canal Telegram
/// via l'API Bot HTTP (https://core.telegram.org/bots/api#sendphoto) — un
/// simple appel multipart, pas de SDK ajouté (même approche que SmsService).
///
/// C'est la SEULE copie de la capture qui existe : elle n'est stockée ni en
/// base ni sur S3 (cf. CapturesService) — Telegram est à la fois le canal de
/// suivi en temps réel ET, via TelegramCommandsService, le canal d'arbitrage
/// manuel en complément de l'OCR.
///
/// MODE NON CONFIGURÉ : si TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID sont absents,
/// on log un avertissement et on ignore silencieusement — jamais bloquant pour
/// le flux principal de soumission de preuve.
@Injectable()
export class TelegramNotifierService {
  private readonly logger = new Logger(TelegramNotifierService.name);

  /// Renvoie soit l'id du message Telegram envoyé (utilisé pour router les
  /// réponses d'arbitrage, cf. TelegramCommandsService), soit un motif
  /// d'échec explicite — distingué pour que CapturesService puisse renvoyer
  /// un message d'erreur diagnostiquable au joueur/à l'admin plutôt qu'un
  /// "indisponible" générique à chaque fois (cf. submitProof).
  ///
  /// Une capture perdue à cause d'un simple pépin réseau transitoire vers
  /// l'API Telegram (timeout, coupure ponctuelle...) est irrécupérable
  /// puisque c'est l'unique copie de la preuve (cf. CapturesService) — d'où
  /// une tentative de renvoi avant d'abandonner, plutôt que d'échouer sec au
  /// premier accroc.
  async sendCapturePhoto(
    imageBuffer: Buffer,
    caption: string,
  ): Promise<{ ok: true; messageId: number | null; fileId: string | null } | { ok: false; reason: 'not_configured' | 'telegram_error' | 'network_error' }> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID non définies — capture non relayée vers Telegram. ' +
          "C'est la cause la plus fréquente d'un échec systématique de l'envoi de preuve : configurer ces " +
          "deux variables d'environnement côté back-end (cf. .env.example) avant de réessayer.",
      );
      return { ok: false, reason: 'not_configured' };
    }

    let lastFailureReason: 'telegram_error' | 'network_error' = 'network_error';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('caption', caption);
        form.append('photo', new Blob([new Uint8Array(imageBuffer)], { type: 'image/png' }), 'capture.png');

        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: form,
        });

        const body = await res.json().catch(() => null);
        if (!res.ok || !body?.ok) {
          this.logger.error(`Échec d'envoi vers Telegram (${res.status}, tentative ${attempt}/2): ${JSON.stringify(body)}`);
          lastFailureReason = 'telegram_error';
          // Une erreur 4xx de l'API Telegram (mauvais chat_id, bot bloqué du
          // canal, token invalide...) ne se résoudra pas en réessayant à
          // l'identique — inutile d'attendre la 2e tentative dans ce cas.
          if (res.status >= 400 && res.status < 500) return { ok: false, reason: 'telegram_error' };
          continue;
        }
        return { ok: true, messageId: body.result?.message_id ?? null, fileId: this.largestPhotoFileId(body.result?.photo) };
      } catch (err) {
        this.logger.error(`Erreur réseau en envoyant la capture vers Telegram (tentative ${attempt}/2):`, err);
        lastFailureReason = 'network_error';
      }
      if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return { ok: false, reason: lastFailureReason };
  }

  /// Réponse textuelle simple (confirmation/erreur d'une commande d'arbitrage,
  /// cf. TelegramCommandsService) — en réponse à un message donné si fourni.
  async sendMessage(text: string, replyToMessageId?: number): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
        }),
      });
    } catch (err) {
      this.logger.error('Erreur réseau en répondant sur Telegram:', err);
    }
  }

  /// Envoie un message avec un clavier inline (boutons de décision) — utilisé
  /// par OcrProcessor quand l'OCR n'a pas pu trancher automatiquement une
  /// preuve, pour permettre à un admin de valider/refuser le duel en un tap
  /// depuis Telegram, sans taper la commande texte /gagnant. La réponse au tap
  /// arrive ensuite en `callback_query` sur le même webhook (cf.
  /// TelegramCommandsService.handleCallbackQuery). Envoyé en réponse au
  /// message contenant la capture d'origine si replyToMessageId est fourni.
  async sendDecisionButtons(
    replyToMessageId: number | undefined,
    text: string,
    buttons: { text: string; callbackData: string }[][],
  ): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return;

    try {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
          reply_markup: {
            inline_keyboard: buttons.map((row) =>
              row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
            ),
          },
        }),
      });
    } catch (err) {
      this.logger.error('Erreur réseau en envoyant les boutons de décision Telegram:', err);
    }
  }

  /// Doit être appelé pour CHAQUE callback_query reçu (même refusé/invalide),
  /// sinon Telegram affiche un spinner de chargement indéfini sur le bouton
  /// côté admin — voir https://core.telegram.org/bots/api#answercallbackquery
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return;

    try {
      await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          ...(text ? { text } : {}),
        }),
      });
    } catch (err) {
      this.logger.error('Erreur réseau en répondant au callback Telegram:', err);
    }
  }

  /// Telegram renvoie plusieurs résolutions de la même photo (tableau trié du
  /// plus petit au plus grand) — on garde la plus grande pour l'affichage
  /// dans la page admin (cf. getProofImage).
  private largestPhotoFileId(photo: { file_id: string }[] | undefined): string | null {
    if (!photo || photo.length === 0) return null;
    return photo[photo.length - 1].file_id;
  }

  /// Retélécharge une capture depuis Telegram à partir de son file_id (cf.
  /// ScreenshotProof.telegramFileId) — utilisé UNIQUEMENT par la page admin
  /// pour afficher la photo au moment de valider un duel (cf.
  /// AdminProofsController.getProofImage). Deux appels sont nécessaires côté
  /// API Telegram : getFile pour résoudre le file_path (les file_id ne sont
  /// pas des URLs directes), puis un GET classique sur le CDN fichiers de
  /// Telegram avec ce chemin — voir
  /// https://core.telegram.org/bots/api#getfile. Ne duplique aucun stockage :
  /// l'image n'est jamais gardée sur ce serveur, seulement relayée à la volée.
  async getProofImage(fileId: string): Promise<{ buffer: Buffer; contentType: string } | null> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return null;

    try {
      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${fileId}`);
      const fileBody = await fileRes.json().catch(() => null);
      const filePath: string | undefined = fileBody?.result?.file_path;
      if (!fileRes.ok || !fileBody?.ok || !filePath) {
        this.logger.error(`Échec getFile Telegram pour file_id=${fileId}: ${JSON.stringify(fileBody)}`);
        return null;
      }

      const downloadRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
      if (!downloadRes.ok) {
        this.logger.error(`Échec du téléchargement du fichier Telegram (${downloadRes.status}): ${filePath}`);
        return null;
      }
      const arrayBuffer = await downloadRes.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: downloadRes.headers.get('content-type') ?? 'image/jpeg',
      };
    } catch (err) {
      this.logger.error(`Erreur réseau en retéléchargeant la capture Telegram (file_id=${fileId}):`, err);
      return null;
    }
  }
}
