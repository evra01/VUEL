import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserNotificationsService } from './user-notifications.service';
import {
  RegisterDeviceDto,
  UnregisterDeviceDto,
  WebPushSubscribeDto,
  WebPushUnsubscribeDto,
} from './dto/push.dto';

@Controller('notifications')
export class UserNotificationsController {
  constructor(private notifications: UserNotificationsService) {}

  // Publique (pas de JwtAuthGuard) : c'est une clé PUBLIQUE par construction
  // (VAPID) — le navigateur en a besoin pour appeler pushManager.subscribe()
  // avant même que le joueur soit forcément déjà authentifié dans certains
  // flux (ex: proposer l'activation dès l'écran d'accueil).
  @Get('push/vapid-public-key')
  vapidPublicKey() {
    return { key: this.notifications.vapidPublicKey };
  }

  @UseGuards(JwtAuthGuard)
  @Post('push/web-subscribe')
  subscribeWeb(@Req() req: any, @Body() dto: WebPushSubscribeDto) {
    return this.notifications.subscribeWeb(req.user.userId, dto.endpoint, dto.p256dh, dto.auth);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('push/web-subscribe')
  unsubscribeWeb(@Req() req: any, @Body() dto: WebPushUnsubscribeDto) {
    return this.notifications.unsubscribeWeb(req.user.userId, dto.endpoint);
  }

  @UseGuards(JwtAuthGuard)
  @Post('push/register-device')
  registerDevice(@Req() req: any, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(req.user.userId, dto.token, dto.platform);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('push/register-device')
  unregisterDevice(@Req() req: any, @Body() dto: UnregisterDeviceDto) {
    return this.notifications.unregisterDevice(req.user.userId, dto.token);
  }

  // ?unread=1 pour n'afficher que les non-lues (ex: liste déroulante rapide) —
  // sans le paramètre, renvoie l'historique complet (50 dernières), utilisé
  // par l'écran "Notifications" dédié.
  @UseGuards(JwtAuthGuard)
  @Get()
  list(@Req() req: any, @Query('unread') unread?: string) {
    return this.notifications.listMine(req.user.userId, unread === '1' || unread === 'true');
  }

  // Alimente le badge numérique sur l'icône cloche — appelé plus souvent que
  // GET /notifications (pas besoin du contenu complet juste pour le badge).
  @UseGuards(JwtAuthGuard)
  @Get('unread-count')
  async unreadCount(@Req() req: any) {
    return { count: await this.notifications.unreadCount(req.user.userId) };
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/read')
  markRead(@Req() req: any, @Param('id') id: string) {
    return this.notifications.markRead(req.user.userId, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('read-all')
  markAllRead(@Req() req: any) {
    return this.notifications.markAllRead(req.user.userId);
  }
}
