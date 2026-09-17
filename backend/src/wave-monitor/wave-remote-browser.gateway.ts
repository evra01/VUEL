import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { WaveRemoteBrowserService, RemoteBrowserFrame } from './wave-remote-browser.service';

/// Retransmet en direct au back-office (pwa/admin.html → écran "🌊 Wave
/// Monitor" → connexion via navigateur distant) une vraie page Wave Business
/// pilotée par un Chromium headless côté serveur (cf.
/// WaveRemoteBrowserService), et relaie les clics/frappes de l'admin vers
/// cette page. Réservé aux admins — mêmes identifiants sensibles en jeu que
/// WaveMonitorAdminController (guard équivalent, ici fait à la main car les
/// gateways WebSocket de Nest n'utilisent pas les guards HTTP classiques,
/// comme DuelRoomGateway.handleConnection).
@WebSocketGateway({ namespace: 'wave-remote', cors: { origin: '*' } })
export class WaveRemoteBrowserGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  // Un seul admin pilote le navigateur distant à la fois (comme la session
  // Wave elle-même, cf. PaymentConfig "singleton") — évite deux admins qui se
  // marchent dessus sur les mêmes clics.
  private controllerSocketId: string | null = null;
  private frameListener?: (frame: RemoteBrowserFrame) => void;
  private capturedListener?: (info: unknown) => void;
  private timeoutListener?: () => void;
  private closedListener?: () => void;

  constructor(
    private jwt: JwtService,
    private browser: WaveRemoteBrowserService,
  ) {}

  handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) throw new UnauthorizedException();
      const payload = this.jwt.verify(token) as { role?: string };
      if (payload.role !== 'ADMIN') throw new UnauthorizedException();
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    if (this.controllerSocketId !== client.id) return;
    this.detachListeners();
    this.controllerSocketId = null;
    // Ferme le Chromium headless si l'admin quitte l'écran sans cliquer
    // "Fermer" — évite un navigateur orphelin qui tourne en arrière-plan.
    this.browser.stop().catch(() => {});
  }

  @SubscribeMessage('start')
  async start(@ConnectedSocket() client: Socket) {
    if (this.controllerSocketId && this.controllerSocketId !== client.id) {
      client.emit('error', { message: 'Un autre admin pilote déjà le navigateur distant.' });
      return;
    }
    this.controllerSocketId = client.id;
    this.attachListeners(client);
    try {
      await this.browser.start();
      client.emit('started', {});
    } catch (e) {
      client.emit('error', {
        message:
          "Impossible de démarrer le navigateur distant (Playwright/Chromium absent du serveur ? cf. WAVE_MONITOR_CHANGES.md) : " +
          String(e),
      });
    }
  }

  @SubscribeMessage('mouse_move')
  onMouseMove(@ConnectedSocket() client: Socket, @MessageBody() data: { x: number; y: number }) {
    if (this.controllerSocketId !== client.id) return;
    void this.browser.mouseMove(data.x, data.y);
  }

  @SubscribeMessage('mouse_down')
  onMouseDown(@ConnectedSocket() client: Socket) {
    if (this.controllerSocketId !== client.id) return;
    void this.browser.mouseDown();
  }

  @SubscribeMessage('mouse_up')
  onMouseUp(@ConnectedSocket() client: Socket) {
    if (this.controllerSocketId !== client.id) return;
    void this.browser.mouseUp();
  }

  @SubscribeMessage('wheel')
  onWheel(@ConnectedSocket() client: Socket, @MessageBody() data: { deltaX: number; deltaY: number }) {
    if (this.controllerSocketId !== client.id) return;
    void this.browser.wheel(data.deltaX, data.deltaY);
  }

  @SubscribeMessage('key')
  onKey(@ConnectedSocket() client: Socket, @MessageBody() data: { key: string }) {
    if (this.controllerSocketId !== client.id) return;
    void this.browser.key(data.key);
  }

  // Bouton "J'ai terminé ma connexion" — filet de secours si la détection
  // automatique (réponse GraphQL avec id de portefeuille, cf.
  // WaveRemoteBrowserService.onResponse) ne se déclenche pas.
  @SubscribeMessage('confirm_login')
  async onConfirmLogin(@ConnectedSocket() client: Socket) {
    if (this.controllerSocketId !== client.id) return;
    const result = await this.browser.captureNow();
    client.emit(result.ok ? 'captured' : 'error', result);
  }

  @SubscribeMessage('stop')
  async onStop(@ConnectedSocket() client: Socket) {
    if (this.controllerSocketId !== client.id) return;
    this.detachListeners();
    this.controllerSocketId = null;
    await this.browser.stop();
    client.emit('stopped', {});
  }

  private attachListeners(client: Socket) {
    this.detachListeners();
    this.frameListener = (frame) => client.emit('frame', frame);
    this.capturedListener = (info) => client.emit('captured', { ok: true, ...(info as object) });
    this.timeoutListener = () => client.emit('timeout', {});
    this.closedListener = () => client.emit('stopped', {});
    this.browser.events.on('frame', this.frameListener);
    this.browser.events.on('captured', this.capturedListener);
    this.browser.events.on('timeout', this.timeoutListener);
    this.browser.events.on('closed', this.closedListener);
  }

  private detachListeners() {
    if (this.frameListener) this.browser.events.off('frame', this.frameListener);
    if (this.capturedListener) this.browser.events.off('captured', this.capturedListener);
    if (this.timeoutListener) this.browser.events.off('timeout', this.timeoutListener);
    if (this.closedListener) this.browser.events.off('closed', this.closedListener);
  }
}
