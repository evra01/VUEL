import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../common/prisma.service';

/// Envoie une notification "comme WhatsApp" — reçue même app fermée — sur les
/// deux canaux possibles pour un joueur :
///  - Web Push (PWA) via la lib `web-push`, protocole standard, PAS besoin de
///    compte externe (juste une paire de clés VAPID, générées une fois et
///    mises dans .env).
///  - FCM (app mobile Flutter) via `firebase-admin`, qui LUI nécessite un
///    projet Firebase créé par l'opérateur (cf. backend/.env.example et le
///    README ajouté pour la marche à suivre — impossible à automatiser
///    depuis ici, ça demande un compte Google/Firebase Console).
///
/// Volontairement tolérant aux pannes : si les clés VAPID ou le service
/// account Firebase ne sont pas configurés, le service log un avertissement
/// UNE fois au démarrage et se contente de no-op ensuite — jamais d'erreur
/// remontée à UserNotificationsService.notify() (qui doit continuer à
/// fonctionner même sans push configuré : la notification reste visible en
/// in-app/temps réel via Socket.io dans tous les cas).
@Injectable()
export class PushDeliveryService implements OnModuleInit {
  private readonly logger = new Logger(PushDeliveryService.name);
  private webPushReady = false;
  private firebaseApp: import('firebase-admin').app.App | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:contact@relaiscabine.example', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      this.webPushReady = true;
    } else {
      this.logger.warn(
        'VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY absents — Web Push (PWA) désactivé. Voir backend/.env.example.',
      );
    }

    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const admin = require('firebase-admin');
        const serviceAccount = JSON.parse(serviceAccountJson);
        this.firebaseApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
      } catch (err) {
        this.logger.error('FIREBASE_SERVICE_ACCOUNT_JSON invalide — FCM (app mobile) désactivé.', err as Error);
      }
    } else {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON absent — FCM (app mobile Flutter) désactivé. Voir backend/.env.example.',
      );
    }
  }

  get vapidPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  /// Appelé par UserNotificationsService.notify() juste après la persistance
  /// en base — jamais attendu de façon bloquante par l'appelant important
  /// (le flux métier), donc toute erreur ici est avalée après log.
  async deliver(userId: string, payload: { title: string; message: string; type: string; data?: Record<string, unknown> }) {
    await Promise.allSettled([this.sendWebPush(userId, payload), this.sendFcm(userId, payload)]);
  }

  private async sendWebPush(userId: string, payload: { title: string; message: string; type: string; data?: Record<string, unknown> }) {
    if (!this.webPushReady) return;
    const subs = await this.prisma.webPushSubscription.findMany({ where: { userId } });
    if (!subs.length) return;
    const body = JSON.stringify({
      title: payload.title,
      body: payload.message,
      type: payload.type,
      data: payload.data ?? {},
    });
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
          );
        } catch (err: any) {
          // 404/410 = abonnement expiré ou navigateur désinstallé/désabonné
          // côté client — on le supprime pour ne pas réessayer indéfiniment
          // à chaque future notification (WhatsApp fait pareil en silence).
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await this.prisma.webPushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Échec Web Push (endpoint ${sub.endpoint.slice(-12)}): ${err?.message ?? err}`);
          }
        }
      }),
    );
  }

  private async sendFcm(userId: string, payload: { title: string; message: string; type: string; data?: Record<string, unknown> }) {
    if (!this.firebaseApp) return;
    const tokens = await this.prisma.deviceToken.findMany({ where: { userId } });
    if (!tokens.length) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const admin = require('firebase-admin');
    const messaging = admin.messaging(this.firebaseApp);
    await Promise.all(
      tokens.map(async (dt) => {
        try {
          await messaging.send({
            token: dt.token,
            notification: { title: payload.title, body: payload.message },
            // FCM exige des chaînes pour toutes les valeurs de `data` — les
            // objets/nombres imbriqués (ex: amount, duelId) sont sérialisés.
            data: Object.fromEntries(
              Object.entries({ type: payload.type, ...(payload.data ?? {}) }).map(([k, v]) => [k, String(v)]),
            ),
          });
        } catch (err: any) {
          // 'messaging/registration-token-not-registered' = app désinstallée
          // ou token périmé (réinstall) — même logique de nettoyage que le
          // Web Push ci-dessus.
          if (err?.code === 'messaging/registration-token-not-registered' || err?.code === 'messaging/invalid-registration-token') {
            await this.prisma.deviceToken.delete({ where: { id: dt.id } }).catch(() => undefined);
          } else {
            this.logger.warn(`Échec FCM (token ${dt.token.slice(-12)}): ${err?.message ?? err}`);
          }
        }
      }),
    );
  }
}
