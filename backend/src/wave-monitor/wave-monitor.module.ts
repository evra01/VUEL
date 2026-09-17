import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { PaymentsModule } from '../payments/payments.module';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WaveSessionService } from './wave-session.service';
import { WaveMonitorService } from './wave-monitor.service';
import { WaveMonitorAdminController } from './wave-monitor-admin.controller';
import { WaveRemoteBrowserService } from './wave-remote-browser.service';
import { WaveRemoteBrowserGateway } from './wave-remote-browser.gateway';

// Module de plus haut niveau (importé depuis AppModule, pas depuis
// PaymentsModule) : il a besoin à la fois de WalletModule (pour créditer un
// dépôt via WalletService.approveDeposit) et NotificationsModule (pour
// alerter sur Telegram) — les mettre ici plutôt que dans PaymentsModule évite
// d'ajouter un 3e nœud à la dépendance circulaire WalletModule ⇄
// NotificationsModule déjà présente (cf. commentaires dans ces deux modules).
@Module({
  imports: [
    PaymentsModule,
    WalletModule,
    NotificationsModule,
    // Requis par WaveRemoteBrowserGateway.handleConnection (vérifie le rôle
    // ADMIN dans le token) — même secret que partout ailleurs, cf. le même
    // pattern dans DuelsModule pour DuelRoomGateway.
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'change-me-in-env' }),
  ],
  controllers: [WaveMonitorAdminController],
  providers: [
    PrismaService,
    WaveSessionService,
    WaveMonitorService,
    WaveRemoteBrowserService,
    WaveRemoteBrowserGateway,
  ],
})
export class WaveMonitorModule {}
