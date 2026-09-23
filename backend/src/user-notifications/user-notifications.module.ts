import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UserNotificationsController } from './user-notifications.controller';
import { UserNotificationsService } from './user-notifications.service';
import { UserNotificationsGateway } from './user-notifications.gateway';
import { PushDeliveryService } from './push-delivery.service';
import { PrismaService } from '../common/prisma.service';

// Module volontairement SANS dépendance vers WalletModule/DuelsModule/
// DisputesModule/TournamentsModule (contrairement à NotificationsModule, cf.
// notifications.module.ts) : ce sont ces modules-là qui importent celui-ci
// (pour appeler UserNotificationsService.notify depuis WalletService,
// DuelsService, EscrowService, DisputesService...), jamais l'inverse — évite
// tout risque de dépendance circulaire supplémentaire dans un graphe de
// modules déjà chargé de forwardRef().
@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? 'change-me-in-env' })],
  controllers: [UserNotificationsController],
  providers: [UserNotificationsService, UserNotificationsGateway, PushDeliveryService, PrismaService],
  exports: [UserNotificationsService],
})
export class UserNotificationsModule {}
