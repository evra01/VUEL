import { Module } from '@nestjs/common';
import { PaymentConfigService } from './payment-config.service';
import { PaymentConfigController } from './payment-config.controller';
import { WavePaymentService } from './wave-payment.service';
import { WaveWebhookController } from './wave-webhook.controller';
import { PaymentConfirmationController } from './payment-confirmation.controller';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [PaymentConfigController, WaveWebhookController, PaymentConfirmationController],
  providers: [PaymentConfigService, WavePaymentService, PrismaService],
  // PaymentConfigService exporté : WalletService en a besoin pour lire le lien
  // Wave fixe (waveDepositLink) dans le flux de dépôt actuel (cf. wallet.service.ts).
  exports: [WavePaymentService, PaymentConfigService],
})
export class PaymentsModule {}
