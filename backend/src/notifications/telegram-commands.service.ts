import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { teamsMatch } from '../common/team-name.util';
import { DuelsService } from '../duels/duels.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { EscrowService } from '../escrow/escrow.service';
import { WalletService } from '../wallet/wallet.service';
import { TelegramNotifierService } from './telegram-notifier.service';

// La légende envoyée avec chaque capture contient toujours "Duel : <uuid>"
// (cf. CapturesService.submitProof) — on la relit depuis le message d'origine
// (reply_to_message) pour savoir quel duel trancher, sans avoir besoin de
// stocker de correspondance message↔duel côté serveur.
const DUEL_ID_PATTERN = /Duel\s*:\s*([0-9a-f-]{36})/i;
const WINNER_COMMAND_PATTERN = /^\/gagnant\s+(.+)$/is;

// callback_data des boutons de décision envoyés par OcrProcessor quand l'OCR
// échoue à trancher automatiquement (cf. sendDecisionButtons) : "wA:<duelId>"
// (le joueur A gagne), "wB:<duelId>" (le joueur B gagne), ou "void:<duelId>"
// (annule le duel et rembourse les deux joueurs). Volontairement compact
// (le callback_data Telegram est limité à 64 octets) — un uuid fait déjà 36
// octets.
const DECISION_CALLBACK_PATTERN = /^(wA|wB|void):([0-9a-f-]{36})$/;

// callback_data des boutons de décision envoyés par WalletService quand un
// joueur soumet une demande de dépôt Wave (lien fixe + validation manuelle,
// cf. WalletService.deposit) : "dep:ok:<transactionId>" (paiement vérifié sur
// le compte Wave, on crédite) ou "dep:no:<transactionId>" (rejeté — numéro
// erroné, jamais reçu, etc).
const DEPOSIT_CALLBACK_PATTERN = /^dep:(ok|no):([0-9a-f-]{36})$/;

/// Canal d'arbitrage manuel EN SUPPLÉMENT de l'OCR (cf. OcrProcessor) : un
/// admin répond directement, sur Telegram, au message contenant la capture
/// avec "/gagnant <nom de l'équipe gagnante>" pour trancher un duel — utile
/// quand l'OCR n'est pas assez confiant (litige), ou simplement pour aller
/// plus vite. C'est TOUJOURS ce service (le bot) qui parle au serveur pour
/// communiquer le nom du vainqueur, jamais l'inverse — le serveur ne pousse
/// aucune question ouverte vers Telegram, il ne fait que réagir aux réponses
/// des admins.
@Injectable()
export class TelegramCommandsService {
  private readonly logger = new Logger(TelegramCommandsService.name);

  constructor(
    private prisma: PrismaService,
    private duelsService: DuelsService,
    private tournamentsService: TournamentsService,
    private escrow: EscrowService,
    private walletService: WalletService,
    private telegram: TelegramNotifierService,
  ) {}

  async handleUpdate(update: any): Promise<void> {
    // Tap sur un des boutons de décision envoyés par OcrProcessor ou
    // WalletService (cf. TelegramNotifierService.sendDecisionButtons) — canal
    // séparé des messages texte classiques traités plus bas.
    if (update?.callback_query) {
      await this.handleCallbackQuery(update.callback_query);
      return;
    }

    const message = update?.message;
    if (!message?.text) return; // pas un message texte (photo, sticker...) → rien à faire

    const commandMatch = message.text.match(WINNER_COMMAND_PATTERN);
    if (!commandMatch) return; // pas une commande d'arbitrage, on ignore silencieusement

    const senderId = String(message.from?.id ?? '');
    if (!this.isAdmin(senderId)) {
      await this.telegram.sendMessage(
        "⛔ Tu n'es pas autorisé à trancher un duel depuis ce compte Telegram.",
        message.message_id,
      );
      return;
    }

    const duelId: string | undefined = message.reply_to_message?.caption?.match(DUEL_ID_PATTERN)?.[1];
    if (!duelId) {
      await this.telegram.sendMessage(
        '⚠️ Réponds directement au message contenant la capture (celui avec "Duel : ...") pour que je sache quel duel trancher.',
        message.message_id,
      );
      return;
    }

    await this.resolveDuel(duelId, commandMatch[1].trim(), message.message_id);
  }

  /// Traite le tap d'un admin sur un des boutons de décision (✅ joueur A /
  /// ✅ joueur B / ❌ annuler) envoyés en complément de l'OCR (cf.
  /// sendDecisionButtons dans OcrProcessor). Répond TOUJOURS via
  /// answerCallbackQuery, même en cas de refus/erreur, sinon le bouton reste
  /// bloqué en "chargement" côté admin.
  private async handleCallbackQuery(callbackQuery: any): Promise<void> {
    const data: string | undefined = callbackQuery.data;

    const depositMatch = data?.match(DEPOSIT_CALLBACK_PATTERN);
    if (depositMatch) {
      await this.handleDepositCallback(callbackQuery, depositMatch);
      return;
    }

    const match = data?.match(DECISION_CALLBACK_PATTERN);
    if (!match) {
      await this.telegram.answerCallbackQuery(callbackQuery.id);
      return;
    }

    const senderId = String(callbackQuery.from?.id ?? '');
    if (!this.isAdmin(senderId)) {
      await this.telegram.answerCallbackQuery(callbackQuery.id, "⛔ Tu n'es pas autorisé à trancher un duel.");
      return;
    }

    const [, action, duelId] = match;
    const replyToMessageId: number | undefined = callbackQuery.message?.message_id;

    // TOUT le traitement (y compris le findUnique) est désormais dans ce
    // try/catch : avant, une exception levée par findUnique (duel introuvable
    // en base à cause d'un id invalide, coupure Prisma, etc.) remontait sans
    // jamais appeler answerCallbackQuery — le bouton restait bloqué et
    // n'affichait RIEN côté admin (le controller webhook avale l'erreur en
    // silence). Voir aussi le log ajouté dans TelegramWebhookController.
    try {
      const duel = await this.prisma.duel.findUnique({ where: { id: duelId } });
      if (!duel) {
        await this.telegram.answerCallbackQuery(callbackQuery.id, 'Duel introuvable.');
        return;
      }
      if (duel.status === 'COMPLETED' || duel.status === 'CANCELLED') {
        await this.telegram.answerCallbackQuery(
          callbackQuery.id,
          `Déjà ${duel.status === 'COMPLETED' ? 'réglé' : 'annulé'} — aucune action effectuée.`,
        );
        return;
      }

      if (action === 'void') {
        if (duel.tournamentId) {
          await this.telegram.answerCallbackQuery(
            callbackQuery.id,
            "Impossible d'annuler un seul match de tournoi ici — utilise le back-office pour annuler le tournoi entier.",
          );
          return;
        }
        await this.voidDuel(duel.id);
        await this.telegram.answerCallbackQuery(callbackQuery.id, 'Duel annulé, joueurs remboursés ✅');
        await this.telegram.sendMessage(
          '❌ Duel annulé depuis le bot — les deux joueurs ont été remboursés (sans commission).',
          replyToMessageId,
        );
        return;
      }

      if (!duel.playerBId) {
        await this.telegram.answerCallbackQuery(callbackQuery.id, "Pas encore de second joueur sur ce duel.");
        return;
      }
      const winnerId = action === 'wA' ? duel.playerAId : duel.playerBId;

      if (duel.tournamentId) {
        await this.tournamentsService.reportMatchResult(duel.id, winnerId);
      } else {
        await this.duelsService.complete(duel.id, winnerId);
      }
      await this.telegram.answerCallbackQuery(callbackQuery.id, 'Duel réglé ✅');
      await this.telegram.sendMessage(
        `✅ Duel réglé depuis le bot — fonds crédités au vainqueur (${action === 'wA' ? 'joueur A' : 'joueur B'}).`,
        replyToMessageId,
      );
    } catch (err: any) {
      this.logger.error('Échec du règlement du duel depuis les boutons Telegram:', err);
      await this.telegram.answerCallbackQuery(callbackQuery.id, 'Erreur — rien n\'a été crédité.');
      await this.telegram.sendMessage(
        `❌ Échec du règlement : ${err?.message ?? 'erreur inconnue côté serveur'}.`,
        replyToMessageId,
      );
    }
  }

  /// Traite le tap d'un admin sur "✅ Paiement reçu" / "❌ Rejeter" pour une
  /// demande de dépôt Wave (lien fixe + validation manuelle, cf.
  /// WalletService.deposit). Répond TOUJOURS via answerCallbackQuery, même en
  /// cas de refus/erreur, sinon le bouton reste bloqué en "chargement".
  private async handleDepositCallback(callbackQuery: any, match: RegExpMatchArray): Promise<void> {
    const senderId = String(callbackQuery.from?.id ?? '');
    if (!this.isAdmin(senderId)) {
      await this.telegram.answerCallbackQuery(callbackQuery.id, '⛔ Tu n\'es pas autorisé à valider un dépôt.');
      return;
    }

    const [, action, transactionId] = match;
    const replyToMessageId: number | undefined = callbackQuery.message?.message_id;

    try {
      if (action === 'ok') {
        await this.walletService.approveDeposit(transactionId);
        await this.telegram.answerCallbackQuery(callbackQuery.id, 'Dépôt crédité ✅');
        await this.telegram.sendMessage('✅ Dépôt validé depuis le bot — le wallet du joueur a été crédité.', replyToMessageId);
      } else {
        await this.walletService.rejectDeposit(transactionId);
        await this.telegram.answerCallbackQuery(callbackQuery.id, 'Dépôt rejeté ❌');
        await this.telegram.sendMessage('❌ Dépôt rejeté depuis le bot — aucun crédit effectué.', replyToMessageId);
      }
    } catch (err: any) {
      this.logger.error('Échec du traitement du dépôt depuis les boutons Telegram:', err);
      await this.telegram.answerCallbackQuery(callbackQuery.id, 'Erreur — rien n\'a été crédité.');
      await this.telegram.sendMessage(
        `❌ Échec du traitement du dépôt : ${err?.message ?? 'erreur inconnue côté serveur'}.`,
        replyToMessageId,
      );
    }
  }

  /// Annule le duel et rembourse les deux joueurs (sans commission), et clôt
  /// tout litige ouvert en cours pour ce duel — même effet que le bouton
  /// "Annuler le match" du back-office (cf. DisputesService.resolve avec
  /// voidMatch), mais déclenchable directement depuis Telegram.
  private async voidDuel(duelId: string): Promise<void> {
    await this.escrow.refund(duelId);
    await this.prisma.dispute.updateMany({
      where: { duelId, status: { in: ['OPEN', 'REVIEWING'] } },
      data: { status: 'RESOLVED', resolution: 'Duel annulé et remboursé depuis le bot Telegram', resolvedAt: new Date() },
    });
  }

  private isAdmin(telegramUserId: string): boolean {
    const admins = (process.env.TELEGRAM_ADMIN_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return telegramUserId.length > 0 && admins.includes(telegramUserId);
  }

  private async resolveDuel(duelId: string, winningTeam: string, replyToMessageId: number): Promise<void> {
    let duel: any;
    try {
      duel = await this.prisma.duel.findUnique({ where: { id: duelId } });
    } catch (err: any) {
      // Même logique de robustesse que handleCallbackQuery : ne jamais
      // laisser une exception Prisma remonter en silence jusqu'au controller
      // webhook (qui l'avale sans rien renvoyer sur Telegram).
      this.logger.error('Échec de la recherche du duel (commande /gagnant):', err);
      await this.telegram.sendMessage(
        `❌ Erreur serveur en cherchant le duel : ${err?.message ?? 'erreur inconnue'}.`,
        replyToMessageId,
      );
      return;
    }
    if (!duel) {
      await this.telegram.sendMessage(`⚠️ Duel introuvable (${duelId}) — a-t-il été supprimé ?`, replyToMessageId);
      return;
    }
    if (duel.status === 'COMPLETED' || duel.status === 'CANCELLED') {
      await this.telegram.sendMessage(
        `⚠️ Ce duel est déjà ${duel.status === 'COMPLETED' ? 'réglé' : 'annulé'} — rien à trancher, aucune action effectuée.`,
        replyToMessageId,
      );
      return;
    }
    if (!duel.playerBId) {
      await this.telegram.sendMessage("⚠️ Ce duel n'a pas encore de second joueur — impossible de désigner un vainqueur.", replyToMessageId);
      return;
    }

    const winnerId = this.matchWinner(duel, winningTeam);
    if (!winnerId) {
      await this.telegram.sendMessage(
        `⚠️ "${winningTeam}" ne correspond à aucune des deux équipes de ce duel (${duel.playerATeam ?? 'équipe A non renseignée'} vs ${duel.playerBTeam ?? 'équipe B non renseignée'}). Vérifie l'orthographe et réessaie.`,
        replyToMessageId,
      );
      return;
    }

    try {
      if (duel.tournamentId) {
        await this.tournamentsService.reportMatchResult(duel.id, winnerId);
      } else {
        await this.duelsService.complete(duel.id, winnerId);
      }
      await this.telegram.sendMessage(
        `✅ Duel tranché en faveur de "${winningTeam}" — les fonds ont été crédités au vainqueur.`,
        replyToMessageId,
      );
    } catch (err: any) {
      // Message spécifique plutôt qu'un "ça a planté" générique : l'admin
      // doit savoir exactement pourquoi le règlement a échoué (ex: escrow
      // déjà libéré, duel invalide) pour décider de la marche à suivre.
      this.logger.error('Échec du règlement du duel depuis Telegram:', err);
      await this.telegram.sendMessage(
        `❌ Échec du règlement du duel : ${err?.message ?? 'erreur inconnue côté serveur'}. Rien n'a été crédité — vérifie l'état du duel avant de réessayer.`,
        replyToMessageId,
      );
    }
  }

  private matchWinner(
    duel: { playerAId: string; playerBId: string | null; playerATeam: string | null; playerBTeam: string | null },
    winningTeam: string,
  ): string | null {
    const aMatches = duel.playerATeam ? teamsMatch(duel.playerATeam, winningTeam) : false;
    const bMatches = duel.playerBTeam ? teamsMatch(duel.playerBTeam, winningTeam) : false;
    if (aMatches && !bMatches) return duel.playerAId;
    if (bMatches && !aMatches) return duel.playerBId;
    return null; // ambigu (correspond aux deux, ou à aucune) → on ne devine pas
  }
}
