import { Prisma } from '@prisma/client';
import { BadRequestException, Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PaymentConfigService } from './payment-config.service';
import { PaymentConfirmationDto } from './dto/payment-confirmation.dto';

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
