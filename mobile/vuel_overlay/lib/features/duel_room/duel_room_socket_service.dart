import 'package:socket_io_client/socket_io_client.dart' as io;
import 'models/duel_room_models.dart';

/// Encapsule la connexion WebSocket au namespace /duels du back-end
/// (cf. DuelRoomGateway côté serveur).
class DuelRoomSocketService {
  final String baseUrl; // ex: https://api.vuel.app
  final String accessToken;
  io.Socket? _socket;

  DuelRoomSocketService({required this.baseUrl, required this.accessToken});

  void connect({
    required String duelId,
    required void Function(Map<String, dynamic> state) onDuelState,
    required void Function(List<String> readyUserIds) onPlayerReady,
    required void Function() onBothReady,
    required void Function(String status) onDuelStarted,
    required void Function(ChatMessage message) onChatMessage,
    required void Function(List<ChatMessage> history) onChatHistory,
    required void Function(String message) onError,
    void Function()? onConnected,
    void Function()? onDisconnected,
  }) {
    _socket = io.io(
      '$baseUrl/duels',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': accessToken})
          .disableAutoConnect()
          .build(),
    );

    _socket!
      ..onConnect((_) {
        onConnected?.call();
        _socket!.emit('join_duel', {'duelId': duelId});
      })
      ..onDisconnect((_) => onDisconnected?.call())
      ..on('duel_state', (data) {
        final map = Map<String, dynamic>.from(data);
        onDuelState(map);
        final rawHistory = map['messages'] as List?;
        if (rawHistory != null) {
          onChatHistory(rawHistory.map((m) => ChatMessage.fromJson(Map<String, dynamic>.from(m))).toList());
        }
      })
      ..on('player_ready', (data) => onPlayerReady(List<String>.from(data['readyUserIds'])))
      ..on('both_ready', (_) => onBothReady())
      ..on('duel_started', (data) => onDuelStarted(data['status'] as String))
      ..on('chat_message', (data) => onChatMessage(ChatMessage.fromJson(Map<String, dynamic>.from(data))))
      ..on('error', (data) => onError(data['message'] as String? ?? 'Erreur inconnue'))
      ..connect();
  }

  void markReady(String duelId) => _socket?.emit('ready', {'duelId': duelId});

  void startDuel(String duelId) => _socket?.emit('start_duel', {'duelId': duelId});

  void sendMessage(String duelId, String message) =>
      _socket?.emit('chat_message', {'duelId': duelId, 'message': message});

  void dispose() {
    _socket?.disconnect();
    _socket?.dispose();
  }
}
