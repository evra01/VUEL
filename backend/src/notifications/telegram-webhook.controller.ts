import { Body, Controller, Logger, Post } from '@nestjs/common';
import { TelegramCommandsService } from './telegram-commands.service';

/// Reçoit les updates du bot Telegram (webhook) — voir TelegramCommandsService
/// pour le traitement des commandes d'arbitrage manuel (/gagnant <équipe>).
///
/// À configurer une fois en production avec :
///   curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook?url=<BASE_URL>/telegram/webhook"
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(private commands: TelegramCommandsService) {}

  @Post('webhook')
  async handle(@Body() update: any) {
    // Telegram exige une réponse HTTP 2xx rapide (sinon il considère le
    // webhook en échec et ré-essaie) — le traitement de la commande ne doit
    // jamais faire échouer cette réponse, les erreurs métier sont déjà
    // renvoyées à l'admin via un message Telegram (cf. TelegramCommandsService).
    // On logue quand même toute exception inattendue ici : avant, une erreur
    // survenant en dehors des try/catch internes (ex: appel Prisma qui plante)
    // disparaissait complètement — ni message Telegram, ni trace serveur, le
    // bouton restait juste bloqué sans rien afficher.
    await this.commands.handleUpdate(update).catch((err) => {
      this.logger.error('Erreur non interceptée en traitant un update Telegram:', err);
    });
    return { ok: true };
  }
}
