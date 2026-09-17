import { Prisma } from '@prisma/client';
import { BadRequestException, Body, Controller, Headers, Post } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { WavePaymentService } from './wave-payment.service';

// Endpoint public (appelé par les serveurs Wave, pas par l'app) — la sécurité repose
// sur la vérification de signature, pas sur un JWT utilisateur.
//
// NOTE : si tu passes par un workflow externe de vérification (n8n/Make/etc.), pointe
// Wave vers CE endpoint n'est plus nécessaire — utilise plutôt
// POST /webhooks/payment-confirmation (cf. PaymentConfirmationController), que ton
// workflow appelle une fois qu'il a lui-même vérifié le paiement. Ce controller-ci
// reste utile si tu veux un jour recevoir les webhooks Wave directement, sans
// intermédiaire.
@Controller('webhooks/wave')
export class WaveWebhookController {
  constructor(
    private prisma: PrismaService,
    private wavePayment: WavePaymentService,
  ) {}

  @Post()
  async handle(@Body() payload: any, @Headers('wave-signature') signature: string | undefined) {
    if (!this.wavePayment.verifyWebhookSignature(JSON.stringify(payload), signature)) {
      throw new BadRequestException('Signature invalide');
    }

    // Format attendu (cf. doc Wave) : payload.type === 'checkout.session.completed',
    // payload.data.client_reference === notre Transaction.id, payload.data.id = session Wave.
    if (payload?.type !== 'checkout.session.completed') {
      return { received: true }; // on ignore les autres types d'événements pour l'instant
    }

    const transactionId = payload.data?.client_reference;
    const sessionId = payload.data?.id;
    if (!transactionId) return { received: true };

    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction || transaction.status !== 'PENDING') return { received: true };

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: 'SUCCESS', externalRef: sessionId },
      });
      await tx.wallet.update({
        where: { id: transaction.walletId },
        data: { balanceAvailable: { increment: transaction.amount } },
      });
    });

    return { received: true };
  }
}
