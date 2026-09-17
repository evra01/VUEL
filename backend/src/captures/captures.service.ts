import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { OcrQueueService } from '../ocr/ocr-queue.service';
import { TelegramNotifierService } from '../notifications/telegram-notifier.service';

@Injectable()
export class CapturesService {
  constructor(
    private prisma: PrismaService,
    private ocrQueue: OcrQueueService,
    private telegram: TelegramNotifierService,
  ) {}

  // Reçoit la capture envoyée par la bulle flottante (Android) ou la notification (iOS).
  // La capture N'EST JAMAIS STOCKÉE (ni DB, ni S3) : elle part directement et
  // uniquement vers Telegram, qui en devient la seule copie durable — utile à
  // la fois comme canal de suivi en temps réel ET, via TelegramCommandsService,
  // comme canal d'arbitrage manuel en complément de l'OCR (un admin peut
  // répondre au message Telegram pour trancher un duel). Le job OCR reçoit
  // l'image en base64 uniquement pour l'analyser (traité puis jeté par
  // OcrProcessor, jamais persisté) — voir OcrProcessor.analyzeImage.
  async submitProof(userId: string, duelId: string, fileBuffer: Buffer) {
    const [user, duel] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } }),
    ]);
    const caption =
      `📸 Preuve — ${duel.game} · ${duel.mode} · ${duel.stakeAmount} F\n` +
      `Envoyée par : ${user?.pseudo ?? userId}\n` +
      // Le code court (ex: K7QX2M) plutôt que l'UUID technique — bien plus
      // simple à relire/vérifier pour un admin, et déjà ce que les joueurs
      // voient/partagent pour rejoindre un salon (cf. DuelsService.resolveDuel).
      // Repli sur l'UUID pour les quelques duels créés avant l'introduction du
      // joinCode (champ nullable en base) — voir TelegramCommandsService, qui
      // sait résoudre l'un OU l'autre.
      `Duel : ${duel.joinCode ?? duel.id}\n\n` +
      `Pour trancher manuellement, répondre à ce message avec :\n` +
      `/gagnant <nom de l'équipe gagnante>`;

    const result = await this.telegram.sendCapturePhoto(fileBuffer, caption);
    if (!result.ok) {
      // Pas de copie de la capture nulle part ailleurs (voir plus haut) : si
      // Telegram est injoignable ou mal configuré, la preuve est purement et
      // simplement perdue. Mieux vaut le dire clairement au joueur tout de
      // suite (message précis selon la cause, distingué côté
      // TelegramNotifierService) que de faire croire que "ça a marché" alors
      // que rien n'a pu être analysé.
      const messages: Record<typeof result.reason, string> = {
        not_configured:
          "Impossible d'envoyer la preuve — le canal de vérification (Telegram) n'est pas configuré côté serveur. Préviens un admin.",
        telegram_error:
          "Impossible d'envoyer la preuve — Telegram a refusé l'envoi (bot/canal mal configuré). Préviens un admin.",
        network_error:
          "Impossible d'envoyer la preuve — le canal de vérification (Telegram) est indisponible. Réessaie dans quelques instants.",
      };
      throw new ServiceUnavailableException(messages[result.reason]);
    }
    const telegramMessageId = result.messageId;

    const proof = await this.prisma.screenshotProof.create({
      data: { duelId, userId, telegramMessageId, telegramFileId: result.fileId },
    });

    await this.ocrQueue.enqueue(proof.id, fileBuffer.toString('base64'));

    return proof;
  }
}
