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
      `Duel : ${duelId}\n\n` +
      `Pour trancher manuellement, répondre à ce message avec :\n` +
      `/gagnant <nom de l'équipe gagnante>`;

    const telegramMessageId = await this.telegram.sendCapturePhoto(fileBuffer, caption);
    if (telegramMessageId === null) {
      // Pas de copie de la capture nulle part ailleurs (voir plus haut) : si
      // Telegram est injoignable ou mal configuré, la preuve est purement et
      // simplement perdue. Mieux vaut le dire clairement au joueur tout de
      // suite (message précis, cf. demande sur les erreurs claires) que de
      // faire croire que "ça a marché" alors que rien n'a pu être analysé.
      throw new ServiceUnavailableException(
        "Impossible d'envoyer la preuve — le canal de vérification (Telegram) est indisponible. Réessaie dans quelques instants.",
      );
    }

    const proof = await this.prisma.screenshotProof.create({
      data: { duelId, userId, telegramMessageId },
    });

    await this.ocrQueue.enqueue(proof.id, fileBuffer.toString('base64'));

    return proof;
  }
}
