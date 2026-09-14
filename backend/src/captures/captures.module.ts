import { Module } from '@nestjs/common';
import { CapturesController } from './captures.controller';
import { CapturesService } from './captures.service';
import { PrismaService } from '../common/prisma.service';
import { OcrModule } from '../ocr/ocr.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [OcrModule, NotificationsModule],
  controllers: [CapturesController],
  providers: [CapturesService, PrismaService],
})
export class CapturesModule {}
