import { forwardRef, Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { PrismaService } from '../common/prisma.service';
import { DuelsModule } from '../duels/duels.module';

@Module({
  // forwardRef : DisputesModule importe DuelsModule ET TournamentsModule
  // ensemble (cf. disputes.module.ts) — évite un cycle de résolution au
  // démarrage. Nécessaire ici pour injecter DuelRoomGateway dans
  // TournamentsService (notifier la fin de délibération d'un match de bracket).
  imports: [forwardRef(() => DuelsModule)],
  controllers: [TournamentsController],
  providers: [TournamentsService, PrismaService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
