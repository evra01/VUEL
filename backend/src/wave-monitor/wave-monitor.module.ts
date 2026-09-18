import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { WaveSessionService } from './wave-session.service';
import { WaveRemoteBrowserService } from './wave-remote-browser.service';
import { WaveRemoteBrowserGateway } from './wave-remote-browser.gateway';
import { PrismaService } from '../common/prisma.service';
import { PaymentConfigService } from '../payments/payment-config.service';

@Module({
  // Même config que DuelsModule/AuthModule : JWT_SECRET partagé, pas besoin
  // de PassportModule ici (le gateway vérifie le token lui-même dans
  // handleConnection, comme DuelRoomGateway).
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? 'change-me-in-env' })],
  providers: [
    PrismaService,
    PaymentConfigService,
    WaveSessionService,
    WaveRemoteBrowserService,
    WaveRemoteBrowserGateway,
  ],
  exports: [WaveSessionService, WaveRemoteBrowserService],
})
export class WaveMonitorModule {}
