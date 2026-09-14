import { Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { PrismaService } from '../common/prisma.service';

@Module({
  controllers: [TournamentsController],
  providers: [TournamentsService, PrismaService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
