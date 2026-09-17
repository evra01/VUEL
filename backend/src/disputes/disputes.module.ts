import { Module } from '@nestjs/common';
import { DisputesController, AdminDisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { PrismaService } from '../common/prisma.service';
import { DuelsModule } from '../duels/duels.module';
import { ReputationModule } from '../reputation/reputation.module';
import { TournamentsModule } from '../tournaments/tournaments.module';

@Module({
  imports: [DuelsModule, ReputationModule, TournamentsModule],
  controllers: [DisputesController, AdminDisputesController],
  providers: [DisputesService, PrismaService],
})
export class DisputesModule {}
