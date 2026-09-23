import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/// Canal temps réel dédié aux notifications personnelles (paiement, retrait,
/// duel, litige...) — namespace séparé de "duels" (cf. DuelRoomGateway) car
/// il n'est pas rattaché à un salon en particulier : un joueur y reste
/// connecté en permanence tant que l'app est ouverte, quel que soit l'écran
/// affiché.
///
/// Même principe d'auth que DuelRoomGateway (JWT dans le handshake), mais la
/// "room" Socket.io ici est l'id de l'utilisateur lui-même plutôt qu'un id de
/// duel : ça permet à UserNotificationsService.notify() d'émettre vers UN
/// joueur précis (`server.to(userId).emit(...)`) sans avoir à suivre la liste
/// des sockets connectés à la main.
@WebSocketGateway({ namespace: 'notifications', cors: { origin: '*' } })
export class UserNotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(private jwt: JwtService) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new UnauthorizedException();
      const payload = this.jwt.verify(token);
      client.data.userId = payload.sub;
      // Une seule room par joueur : tous ses onglets/appareils connectés
      // reçoivent la même notification.
      client.join(payload.sub);
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect() {
    // Rien à nettoyer : Socket.io retire automatiquement le client de ses
    // rooms à la déconnexion.
  }

  /// Appelé par UserNotificationsService juste après la persistance en base —
  /// jamais bloquant pour l'appelant (le joueur reçoit son historique complet
  /// au prochain GET /notifications de toute façon s'il est hors ligne).
  emitToUser(userId: string, payload: Record<string, unknown>) {
    this.server.to(userId).emit('notification', payload);
  }
}
