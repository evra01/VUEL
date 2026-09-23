import { Module } from '@nestjs/common';
import { DisputesController, AdminDisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../common/prisma.service';
import { DuelsModule } from '../duels/duels.module';
import { ReputationModule } from '../reputation/reputation.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { UserNotificationsModule } from '../user-notifications/user-notifications.module';

@Module({
  // UserNotificationsModule : DisputesService notifie l'autre joueur à
  // l'ouverture d'un litige (cf. report()) — la résolution elle-même est déjà
  // couverte par les notifications de résultat de duel émises depuis
  // EscrowService (via duelsService.complete/escrow.refund appelés ici).
  imports: [DuelsModule, ReputationModule, TournamentsModule, UserNotificationsModule],
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputesService, PrismaService],
})
export class DisputesModule {}
