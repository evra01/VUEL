import { forwardRef, Module } from '@nestjs/common';
import { SmsConfigService } from './sms-config.service';
import { SmsConfigController } from './sms-config.controller';
import { SmsService } from './sms.service';
import { TelegramNotifierService } from './telegram-notifier.service';
import { TelegramCommandsService } from './telegram-commands.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { PrismaService } from '../common/prisma.service';
import { DuelsModule } from '../duels/duels.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  // forwardRef : WalletModule importe aussi NotificationsModule (pour que
  // WalletService envoie la notification de demande de dépôt via
  // TelegramNotifierService) — dépendance circulaire entre les deux modules.
  imports: [DuelsModule, TournamentsModule, forwardRef(() => WalletModule)],
  controllers: [SmsConfigController, TelegramWebhookController],
  providers: [SmsConfigService, SmsService, TelegramNotifierService, TelegramCommandsService, PrismaService],
  exports: [SmsService, TelegramNotifierService],
})
export class NotificationsModule {}
