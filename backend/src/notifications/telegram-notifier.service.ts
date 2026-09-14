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

  /// Renvoie l'id du message Telegram envoyé (utilisé pour router les
  /// réponses d'arbitrage, cf. TelegramCommandsService), ou null si l'envoi
  /// a échoué ou que Telegram n'est pas configuré.
  async sendCapturePhoto(imageBuffer: Buffer, caption: string): Promise<number | null> {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!token || !chatId) {
      this.logger.warn(
        'TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID non définies — capture non relayée vers Telegram.',
      );
      return null;
    }

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
        this.logger.error(`Échec d'envoi vers Telegram (${res.status}): ${JSON.stringify(body)}`);
        return null;
      }
      return body.result?.message_id ?? null;
    } catch (err) {
      // Ne jamais faire échouer la soumission de preuve à cause d'un souci
      // réseau/Telegram — c'est un canal secondaire, pas le flux critique.
      this.logger.error('Erreur réseau en envoyant la capture vers Telegram:', err);
      return null;
    }
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
}
