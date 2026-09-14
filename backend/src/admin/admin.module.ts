import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminController } from './admin.controller';
import { PrismaService } from '../common/prisma.service';
import { WalletModule } from '../wallet/wallet.module';

@Module({
  // WalletModule : pour valider/rejeter un dépôt depuis le back-office avec la
  // même logique (idempotente) que la validation depuis Telegram — cf.
  // WalletService.approveDeposit/rejectDeposit, appelés depuis AdminController.
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? 'change-me-in-env' }), WalletModule],
  controllers: [AdminController],
  providers: [PrismaService],
})
export class AdminModule {}
