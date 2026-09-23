import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { UserNotificationsGateway } from './user-notifications.gateway';
import { PushDeliveryService } from './push-delivery.service';

@Injectable()
export class UserNotificationsService {
  constructor(
    private prisma: PrismaService,
    private gateway: UserNotificationsGateway,
    private pushDelivery: PushDeliveryService,
  ) {}

  /// Point d'entrée UNIQUE pour créer une notification "grande étape" — appelé
  /// depuis WalletService (dépôt/retrait), DuelsService/EscrowService (résultat
  /// de duel) et DisputesService (litige). Persiste toujours en base (le joueur
  /// doit retrouver son historique même hors ligne au moment de l'événement),
  /// puis pousse en plus l'événement en temps réel si un socket est connecté
  /// (cf. UserNotificationsGateway) — jamais bloquant : une notification n'est
  /// qu'un complément d'information, elle ne doit jamais faire échouer le flux
  /// métier (paiement, résultat de duel...) qui l'a déclenchée.
  async notify(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, unknown>,
  ) {
    const notification = await this.prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    try {
      this.gateway.emitToUser(userId, notification);
    } catch {
      // Une erreur d'émission socket (ex: pas de client connecté sur ce
      // process) ne doit jamais remonter à l'appelant — la notification est
      // de toute façon déjà persistée et sera vue au prochain chargement.
    }
    // Push "comme WhatsApp" — reçu même app fermée (Web Push PWA + FCM
    // mobile). Best-effort au même titre que le socket ci-dessus : jamais
    // d'`await` bloquant qui ferait échouer le flux métier appelant si
    // l'envoi push traîne ou échoue (cf. PushDeliveryService).
    this.pushDelivery.deliver(userId, { title, message, type, data }).catch(() => undefined);
    return notification;
  }

  listMine(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { read: false } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, read: false } });
  }

  async markRead(userId: string, id: string) {
    // updateMany plutôt que update() : filtre directement sur userId pour
    // qu'un joueur ne puisse jamais marquer comme lue la notification d'un
    // autre en devinant son id, sans requête de vérification séparée.
    const result = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    if (result.count === 0) throw new NotFoundException('Notification introuvable.');
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { ok: true };
  }

  // ---- Abonnements push (comme WhatsApp) ----

  get vapidPublicKey() {
    return this.pushDelivery.vapidPublicKey;
  }

  /// upsert par `endpoint` : un même navigateur qui se réabonne (ex: après
  /// avoir révoqué puis raccordé la permission) écrase juste ses clés, plutôt
  /// que de créer un doublon qui recevrait chaque notification deux fois.
  subscribeWeb(userId: string, endpoint: string, p256dh: string, auth: string) {
    return this.prisma.webPushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh, auth },
      update: { userId, p256dh, auth },
    });
  }

  async unsubscribeWeb(userId: string, endpoint: string) {
    // deleteMany plutôt que delete() : filtre sur userId en plus de endpoint
    // pour qu'un joueur ne puisse pas désabonner l'endpoint d'un autre.
    await this.prisma.webPushSubscription.deleteMany({ where: { userId, endpoint } });
    return { ok: true };
  }

  /// upsert par `token` : le token FCM d'un appareil peut être réémis par le
  /// SDK (rotation, réinstallation) — cf. PushService côté Flutter qui
  /// ré-enregistre à chaque démarrage plutôt qu'une seule fois à vie.
  registerDevice(userId: string, token: string, platform = 'ANDROID') {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async unregisterDevice(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { ok: true };
  }
}
