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
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WaveRemoteBrowserService } from './wave-remote-browser.service';

/// Salon admin-only qui pilote WaveRemoteBrowserService à distance : diffuse
/// les frames JPEG (cf. events.on('frame')) au(x) client(s) connecté(s), et
/// relaie les événements souris/clavier envoyés par le back-office vers la
/// vraie page Wave (l'admin voit et contrôle un vrai Chromium headless comme
/// s'il naviguait lui-même sur business.wave.com).
///
/// Un seul namespace, pas de "room" par admin : un seul navigateur distant
/// tourne à la fois côté serveur (cf. WaveRemoteBrowserService.running), donc
/// tous les clients connectés partagent le même flux — pratique si deux
/// admins veulent superviser la même connexion.
@WebSocketGateway({ namespace: 'wave-remote-browser', cors: { origin: '*' } })
export class WaveRemoteBrowserGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private jwt: JwtService,
    private remoteBrowser: WaveRemoteBrowserService,
  ) {}

  // Auth via JWT dans le handshake (socket.io: auth: { token }), comme
  // DuelRoomGateway — mais ADMIN uniquement ici : ce salon donne un contrôle
  // direct du compte Wave Business, contrairement au salon de duel qui est
  // ouvert à tout joueur authentifié.
  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new UnauthorizedException();
      const payload = this.jwt.verify(token) as { sub: string; role: string };
      if (payload.role !== 'ADMIN') throw new UnauthorizedException();
      client.data.userId = payload.sub;
    } catch {
      client.disconnect();
      return;
    }

    // Abonnement aux évènements du navigateur distant pour CE client. Chaque
    // connexion socket a ses propres listeners (nettoyés dans
    // handleDisconnect) plutôt qu'un seul abonnement global, pour éviter les
    // doublons d'écoute si plusieurs admins se connectent/déconnectent.
    const onFrame = (frame: { data: string; width: number; height: number }) => client.emit('frame', frame);
    const onClosed = () => client.emit('closed');
    const onTimeout = () => client.emit('timeout');
    const onCaptured = (info: { hasSId: boolean; walletId: string | null }) => client.emit('captured', info);

    this.remoteBrowser.events.on('frame', onFrame);
    this.remoteBrowser.events.on('closed', onClosed);
    this.remoteBrowser.events.on('timeout', onTimeout);
    this.remoteBrowser.events.on('captured', onCaptured);

    client.data.cleanup = () => {
      this.remoteBrowser.events.off('frame', onFrame);
      this.remoteBrowser.events.off('closed', onClosed);
      this.remoteBrowser.events.off('timeout', onTimeout);
      this.remoteBrowser.events.off('captured', onCaptured);
    };

    client.emit('status', { running: this.remoteBrowser.running });
  }

  handleDisconnect(client: Socket) {
    client.data.cleanup?.();
  }

  @SubscribeMessage('start')
  async start(@ConnectedSocket() client: Socket) {
    if (!client.data.userId) return;
    try {
      await this.remoteBrowser.start();
      client.emit('status', { running: true });
    } catch (e) {
      client.emit('error', { message: `Impossible de démarrer le navigateur distant : ${e}` });
    }
  }

  @SubscribeMessage('stop')
  async stop(@ConnectedSocket() client: Socket) {
    if (!client.data.userId) return;
    await this.remoteBrowser.stop();
    client.emit('status', { running: false });
  }

  @SubscribeMessage('capture_now')
  async captureNow(@ConnectedSocket() client: Socket) {
    if (!client.data.userId) return;
    const result = await this.remoteBrowser.captureNow();
    client.emit('capture_result', result);
  }

  @SubscribeMessage('mouse_move')
  mouseMove(@ConnectedSocket() client: Socket, @MessageBody() data: { x: number; y: number }) {
    if (!client.data.userId) return;
    this.remoteBrowser.mouseMove(data.x, data.y);
  }

  @SubscribeMessage('mouse_down')
  mouseDown(@ConnectedSocket() client: Socket) {
    if (!client.data.userId) return;
    this.remoteBrowser.mouseDown();
  }

  @SubscribeMessage('mouse_up')
  mouseUp(@ConnectedSocket() client: Socket) {
    if (!client.data.userId) return;
    this.remoteBrowser.mouseUp();
  }

  @SubscribeMessage('wheel')
  wheel(@ConnectedSocket() client: Socket, @MessageBody() data: { deltaX: number; deltaY: number }) {
    if (!client.data.userId) return;
    this.remoteBrowser.wheel(data.deltaX, data.deltaY);
  }

  @SubscribeMessage('key')
  key(@ConnectedSocket() client: Socket, @MessageBody() data: { key: string }) {
    if (!client.data.userId) return;
    this.remoteBrowser.key(data.key);
  }
}
