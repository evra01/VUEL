import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DuelsController } from './duels.controller';
import { DuelInviteController } from './duel-invite.controller';
import { DuelsService } from './duels.service';
import { DuelRoomGateway } from './duel-room.gateway';
import { EscrowService } from '../escrow/escrow.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_SECRET ?? 'change-me-in-env' })],
  controllers: [DuelsController, DuelInviteController],
  providers: [DuelsService, EscrowService, PrismaService, DuelRoomGateway],
  // DuelRoomGateway exportée : EscrowService.release/refund (ici) et
  // TournamentsService.reportMatchResult (cf. tournaments.module.ts) en ont
  // besoin pour notifier le client ('duel_resolved') que la délibération est
  // terminée et que la bulle de capture doit se fermer.
  exports: [DuelsService, EscrowService, DuelRoomGateway],
})
export class DuelsModule {}
