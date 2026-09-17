import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminController } from './admin.controller';
import { AdminProofsController } from './admin-proofs.controller';
import { PrismaService } from '../common/prisma.service';
import { WalletModule } from '../wallet/wallet.module';
import { DuelsModule } from '../duels/duels.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // WalletModule : pour valider/rejeter un dépôt depuis le back-office avec la
  // même logique (idempotente) que la validation depuis Telegram — cf.
  // WalletService.approveDeposit/rejectDeposit, appelés depuis AdminController.
  // DuelsModule (DuelsService + EscrowService), TournamentsModule et
  // NotificationsModule (TelegramNotifierService, pour retélécharger l'image
  // d'une preuve) : requis par AdminProofsController pour régler un duel et
  // afficher sa capture, exactement comme le fait TelegramCommandsService.
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'change-me-in-env' }),
    WalletModule,
    DuelsModule,
    TournamentsModule,
    NotificationsModule,
  ],
  controllers: [AdminController, AdminProofsController],
  providers: [PrismaService],
})
export class AdminModule {}
