import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { forwardRef, Inject, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../common/prisma.service';
import { DuelsService } from './duels.service';

interface ChatMessageRecord {
  userId: string;
  message: string;
  sentAt: string;
}

interface DuelRoomState {
  readyUserIds: Set<string>;
  // Historique en mémoire pour ce salon — permet à un joueur qui se reconnecte
  // (perte réseau, app mise en arrière-plan) de retrouver la conversation au
  // lieu de repartir d'un tchat vide. Comme readyUserIds, à migrer vers Redis
  // si l'app tourne un jour sur plusieurs instances.
  messages: ChatMessageRecord[];
}

const MAX_MESSAGE_LENGTH = 300;
const MAX_HISTORY_SIZE = 200;

/// Salon privé temps réel d'un duel : échange auto des IDs de jeu, tchat privé,
/// et boutons d'état « Prêt » / « Lancer » (cf. cahier des charges 3.3).
/// L'état "prêt" est gardé en mémoire ici — à migrer vers Redis si l'app tourne
/// sur plusieurs instances (sinon deux joueurs connectés à des pods différents
/// ne se synchronisent pas).
@WebSocketGateway({ namespace: 'duels', cors: { origin: '*' } })
export class DuelRoomGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  private rooms = new Map<string, DuelRoomState>();

  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
    // forwardRef nécessaire : DuelsController → DuelsService → EscrowService →
    // DuelRoomGateway → DuelsService referme le cycle d'imports. Sans ceci, la
    // métadonnée de type de ce paramètre est capturée `undefined` au moment où
    // ce fichier est chargé (DuelsService est encore en cours de chargement
    // plus haut dans la chaîne) → Nest ne sait plus quoi injecter à l'index 2
    // (cf. EscrowService, qui a le même correctif dans l'autre sens du cycle).
    @Inject(forwardRef(() => DuelsService)) private duelsService: DuelsService,
  ) {}

  // Auth via le token JWT passé dans le handshake (socket.io: auth: { token }).
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new UnauthorizedException();
      const payload = this.jwt.verify(token);
      client.data.userId = payload.sub;
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    // TODO: notifier l'adversaire d'une déconnexion (utile pour le module litiges)
  }

  @SubscribeMessage('join_duel')
  async joinDuel(@ConnectedSocket() client: Socket, @MessageBody() data: { duelId: string }) {
    const duel = await this.duelsService.get(data.duelId);
    const userId = client.data.userId;
    if (![duel.playerAId, duel.playerBId].includes(userId)) {
      throw new UnauthorizedException('Vous ne participez pas à ce duel');
    }

    client.join(data.duelId);
    if (!this.rooms.has(data.duelId)) {
      this.rooms.set(data.duelId, { readyUserIds: new Set(), messages: [] });
    }

    // Échange automatique des IDs de jeu dès l'arrivée dans le salon.
    const [playerA, playerB] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: duel.playerAId },
        include: { gamingIds: { where: { game: duel.game } } },
      }),
      duel.playerBId
        ? this.prisma.user.findUnique({
            where: { id: duel.playerBId },
            include: { gamingIds: { where: { game: duel.game } } },
          })
        : null,
    ]);

    this.server.to(data.duelId).emit('duel_state', {
      duelId: data.duelId,
      status: duel.status,
      players: {
        [duel.playerAId]: {
          pseudo: playerA?.pseudo,
          gamingId: playerA?.gamingIds[0]?.gamePseudo,
          avatarId: playerA?.avatarId,
        },
        ...(duel.playerBId
          ? {
              [duel.playerBId]: {
                pseudo: playerB?.pseudo,
                gamingId: playerB?.gamingIds[0]?.gamePseudo,
                avatarId: playerB?.avatarId,
              },
            }
          : {}),
      },
      readyUserIds: Array.from(this.rooms.get(data.duelId)!.readyUserIds),
      // Envoyé uniquement au moment du join — permet au client de reconstituer
      // le fil de discussion s'il rejoint après coup ou se reconnecte.
      messages: this.rooms.get(data.duelId)!.messages,
    });
  }

  @SubscribeMessage('ready')
  async setReady(@ConnectedSocket() client: Socket, @MessageBody() data: { duelId: string }) {
    const room = this.rooms.get(data.duelId);
    if (!room) return;
    room.readyUserIds.add(client.data.userId);

    this.server.to(data.duelId).emit('player_ready', {
      userId: client.data.userId,
      readyUserIds: Array.from(room.readyUserIds),
    });

    const duel = await this.duelsService.get(data.duelId);
    const bothReady =
      duel.playerBId &&
      room.readyUserIds.has(duel.playerAId) &&
      room.readyUserIds.has(duel.playerBId);

    if (bothReady) {
      this.server.to(data.duelId).emit('both_ready', { duelId: data.duelId });
    }
  }

  // Ne peut être déclenché que si les deux joueurs sont prêts — déclenche l'escrow côté back-end.
  @SubscribeMessage('start_duel')
  async startDuel(@ConnectedSocket() client: Socket, @MessageBody() data: { duelId: string }) {
    const room = this.rooms.get(data.duelId);
    const duel = await this.duelsService.get(data.duelId);
    const bothReady =
      room &&
      duel.playerBId &&
      room.readyUserIds.has(duel.playerAId) &&
      room.readyUserIds.has(duel.playerBId);

    if (!bothReady) {
      client.emit('error', { message: 'Les deux joueurs doivent être prêts avant de lancer.' });
      return;
    }

    const updated = await this.duelsService.start(data.duelId);
    this.server.to(data.duelId).emit('duel_started', { duelId: data.duelId, status: updated.status });
  }

  @SubscribeMessage('chat_message')
  chatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { duelId: string; message: string },
  ) {
    const room = this.rooms.get(data.duelId);
    if (!room) {
      client.emit('error', { message: 'Rejoins d\'abord le salon avant d\'envoyer un message.' });
      return;
    }

    const trimmed = (data.message ?? '').trim();
    if (!trimmed) return; // message vide (ex: que des espaces) — on ignore silencieusement
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      client.emit('error', { message: `Message trop long (max ${MAX_MESSAGE_LENGTH} caractères).` });
      return;
    }

    const record: ChatMessageRecord = {
      userId: client.data.userId,
      message: trimmed,
      sentAt: new Date().toISOString(),
    };

    room.messages.push(record);
    if (room.messages.length > MAX_HISTORY_SIZE) {
      room.messages.splice(0, room.messages.length - MAX_HISTORY_SIZE);
    }

    // TODO: persistance en base optionnelle si le contenu du tchat doit un jour
    // servir de preuve pour le module litiges (cf. DisputesService.getCaseFile).
    this.server.to(data.duelId).emit('chat_message', record);
  }

  // Diffuse la décision finale (OCR auto, arbitrage Telegram, page admin ou
  // litige — cf. EscrowService.release/refund et
  // TournamentsService.reportMatchResult, seuls points qui font passer un
  // duel à COMPLETED/CANCELLED) au salon temps réel du duel. AVANT ce fix,
  // rien n'était jamais émis ici : le client ne recevait donc aucun signal
  // de fin de délibération et la bulle de capture Android restait affichée
  // indéfiniment après l'arbitrage, même une fois le duel réglé côté serveur.
  notifyDuelResolved(duelId: string, status: 'COMPLETED' | 'CANCELLED', winnerId?: string | null) {
    this.server.to(duelId).emit('duel_resolved', { duelId, status, winnerId: winnerId ?? null });
  }
}
