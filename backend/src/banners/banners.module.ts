import { Module } from '@nestjs/common';
import { BannersController } from './banners.controller';
import { AdminBannersController } from './admin-banners.controller';
import { PrismaService } from '../common/prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  // NotificationsModule : TelegramNotifierService, pour relayer l'upload et
  // retélécharger l'image à l'affichage (cf. les deux contrôleurs).
  imports: [NotificationsModule],
  controllers: [BannersController, AdminBannersController],
  providers: [PrismaService],
})
export class BannersModule {}
