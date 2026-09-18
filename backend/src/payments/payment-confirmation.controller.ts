import { Prisma } from '@prisma/client';
import { BadRequestException, Body, Controller, Get, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PaymentConfigService } from './payment-config.service';
import { PaymentConfirmationDto, WaveMonitorHeartbeatDto } from './dto/payment-confirmation.dto';

/// Point d'entrée générique pour un workflow externe de vérification de paiement
/// (ex: n8n/Make/Zapier qui reçoit le webhook Wave, le vérifie, puis nous notifie
/// ici). Indépendant du format du provider — contrairement à WaveWebhookController
/// qui attend le payload exact de Wave, celui-ci attend un format simple et fixe.
///
/// Authentification : header X-Webhook-Secret, à faire correspondre à la valeur
/// configurée via PATCH /admin/payment-config (champ webhookSharedSecret).
@Controller('webhooks/payment-confirmation')
export class PaymentConfirmationController {
  constructor(
    private prisma: PrismaService,
    private paymentConfig: PaymentConfigService,
  ) {}

  // Liste des dépôts Wave en attente (mêmes lignes que GET /admin/deposits,
  // mais accessible avec le secret webhook plutôt qu'un JWT admin) — permet à
  // un monitor externe (ex: vuel_wave_monitor.py) de savoir quels montants/
  // numéros il doit chercher dans l'historique du compte Wave Business, sans
  // avoir besoin du mot de passe admin. N'expose que le strict nécessaire au
  // matching (pas les infos utilisateur autres que le téléphone déclaré).
  @Get('pending')
  async pending(@Headers('x-webhook-secret') secret: string | undefined) {
    const valid = await this.paymentConfig.verifyWebhookSecret(secret);
    if (!valid) {
      throw new UnauthorizedException('Secret de webhook invalide ou non configuré');
    }

    const deposits = await this.prisma.transaction.findMany({
      where: { type: 'DEPOSIT', provider: 'wave', status: 'PENDING' },
      orderBy: { createdAt: 'asc' }, // plus ancien d'abord — sert de règle de départage FIFO si deux dépôts ont le même montant
      select: { id: true, amount: true, payerPhone: true, createdAt: true },
    });

    return {
      pending: deposits.map((d) => ({
        transactionId: d.id,
        amount: d.amount,
        payerPhone: d.payerPhone,
        createdAt: d.createdAt,
      })),
    };
  }

  // Heartbeat envoyé par vuel_wave_monitor.py à chaque cycle (~30s) — alimente
  // WaveMonitorStatus, lu par GET /admin/wave-monitor pour la page "Wave
  // Monitor" du back-office. Upsert car la ligne singleton peut ne pas encore
  // exister au tout premier heartbeat.
  @Post('heartbeat')
  async heartbeat(
    @Body() dto: WaveMonitorHeartbeatDto,
    @Headers('x-webhook-secret') secret: string | undefined,
  ) {
    const valid = await this.paymentConfig.verifyWebhookSecret(secret);
    if (!valid) {
      throw new UnauthorizedException('Secret de webhook invalide ou non configuré');
    }

    const existing = await this.prisma.waveMonitorStatus.findUnique({ where: { id: 'singleton' } });
    const totalValidated = (existing?.totalValidated ?? 0) + dto.lastCycleValidated;

    await this.prisma.waveMonitorStatus.upsert({
      where: { id: 'singleton' },
      create: {
        id: 'singleton',
        waveSessionActive: dto.waveSessionActive,
        waveExpiresAt: dto.waveExpiresAt ? new Date(dto.waveExpiresAt) : null,
        lastCycleValidated: dto.lastCycleValidated,
        totalValidated,
        lastError: dto.lastError,
      },
      update: {
        waveSessionActive: dto.waveSessionActive,
        waveExpiresAt: dto.waveExpiresAt ? new Date(dto.waveExpiresAt) : null,
        lastCycleValidated: dto.lastCycleValidated,
        totalValidated,
        lastError: dto.lastError ?? null, // reset si plus d'erreur (pas de merge avec l'ancienne)
      },
    });

    return { received: true };
  }

  @Post()
  async confirm(
    @Body() dto: PaymentConfirmationDto,
    @Headers('x-webhook-secret') secret: string | undefined,
  ) {
    const valid = await this.paymentConfig.verifyWebhookSecret(secret);
    if (!valid) {
      throw new UnauthorizedException('Secret de webhook invalide ou non configuré');
    }

    const transaction = await this.prisma.transaction.findUnique({ where: { id: dto.transactionId } });
    if (!transaction) {
      throw new BadRequestException('Transaction introuvable');
    }
    if (transaction.status !== 'PENDING') {
      return { received: true, alreadyProcessed: true }; // idempotent : on ignore si déjà traité
    }

    if (dto.status === 'FAILED') {
      await this.prisma.transaction.update({
        where: { id: dto.transactionId },
        data: { status: 'FAILED', externalRef: dto.externalRef },
      });
      return { received: true };
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.transaction.update({
        where: { id: dto.transactionId },
        data: { status: 'SUCCESS', externalRef: dto.externalRef },
      });
      await tx.wallet.update({
        where: { id: transaction.walletId },
        data: { balanceAvailable: { increment: transaction.amount } },
      });
    });

    return { received: true };
  }
}
