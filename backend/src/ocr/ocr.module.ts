import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OcrQueueService } from './ocr-queue.service';
import { OcrProcessor } from './ocr.processor';
import { OcrAnalysisService } from './ocr-analysis.service';
import { PrismaService } from '../common/prisma.service';
import { DuelsModule } from '../duels/duels.module';
import { TournamentsModule } from '../tournaments/tournaments.module';
import { NotificationsModule } from '../notifications/notifications.module';

// La queue BullMQ ('ocr') n'est enregistrée QUE si REDIS_HOST est défini —
// sans ça, BullModule tente de se connecter à un Redis (localhost par
// défaut, cf. app.module.ts) qui n'existe pas forcément en prod, et
// `queue.add()` reste bloqué indéfiniment (cf. commentaire dans
// ocr-queue.service.ts). Sans REDIS_HOST, OcrProcessor n'est pas instancié
// du tout : OcrQueueService traite alors les preuves directement via
// OcrAnalysisService (voir ocr-queue.service.ts).
const hasRedis = !!process.env.REDIS_HOST;

@Module({
  imports: [
    ...(hasRedis ? [BullModule.registerQueue({ name: 'ocr' })] : []),
    DuelsModule,
    TournamentsModule,
    NotificationsModule,
  ],
  providers: [
    OcrQueueService,
    OcrAnalysisService,
    ...(hasRedis ? [OcrProcessor] : []),
    PrismaService,
  ],
  exports: [OcrQueueService],
})
export class OcrModule {}
