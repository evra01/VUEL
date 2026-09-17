import { forwardRef, Module } from '@nestjs/common';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';
import { PrismaService } from '../common/prisma.service';
import { PaymentsModule } from '../payments/payments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // forwardRef : NotificationsModule importe aussi WalletModule (pour que
  // TelegramCommandsService puisse appeler approveDeposit/rejectDeposit
  // depuis les boutons de décision Telegram sur une demande de dépôt) —
  // dépendance circulaire entre les deux modules.
  imports: [PaymentsModule, forwardRef(() => NotificationsModule)],
  controllers: [WalletController],
  providers: [WalletService, PrismaService],
  exports: [WalletService],
})
export class WalletModule {}
