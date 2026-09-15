import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'duel_room_socket_service.dart';
import 'models/duel_room_models.dart';
import 'widgets/chat_bubble.dart';
import 'widgets/player_card.dart';
import '../capture/capture_controller.dart';
import '../capture/widgets/capture_status_banner.dart';
import '../device_setup/device_setup_screen.dart';
import '../../core/api/user_api_client.dart';
import '../../core/theme/vuel_theme.dart';
import '../../core/share/duel_share.dart';

class DuelRoomScreen extends StatefulWidget {
  final String duelId;
  /// Code court du salon (cf. DuelsService.generateJoinCode) utilisé pour le
  /// partage — null pour un salon créé avant l'ajout de ce champ, auquel cas
  /// shareDuelInvite se rabat sur duelId (cf. duel_share.dart).
  final String? joinCode;
  final String baseUrl;
  final String accessToken;
  final String currentUserId;
  /// Voir DuelsApiClient.onUnauthorized — permet à UserApiClient (utilisé ici
  /// pour l'écran de permissions overlay) de rafraîchir le token en silence
  /// si le salon reste ouvert plus de 15 min.
  final Future<bool> Function()? onUnauthorized;

  const DuelRoomScreen({
    super.key,
    required this.duelId,
    this.joinCode,
    required this.baseUrl,
    required this.accessToken,
    required this.currentUserId,
    this.onUnauthorized,
  });

  @override
  State<DuelRoomScreen> createState() => _DuelRoomScreenState();
}

class _DuelRoomScreenState extends State<DuelRoomScreen> {
  late final DuelRoomSocketService _socketService;
  final _captureController = CaptureController();
  late final UserApiClient _userClient = UserApiClient(
    baseUrl: widget.baseUrl,
    getAccessToken: () => widget.accessToken,
    onUnauthorized: widget.onUnauthorized,
  );
  StreamSubscription<CaptureStatus>? _captureSub;
  CaptureStatus _captureStatus = CaptureStatus.idle;
  final _chatController = TextEditingController();
  final _chatScrollController = ScrollController();

  Map<String, DuelPlayerInfo> _players = {};
  List<String> _readyUserIds = [];
  // Fil unifié : messages de tchat ET événements système ('X est prêt', 'Le
  // duel a commencé') mélangés dans l'ordre chronologique — rend le tchat
  // plus vivant et évite d'avoir à surveiller deux zones séparées de l'écran.
  final List<Object> _timeline = [];
  String _status = 'OPEN';
  bool _bothReady = false;
  bool _connected = false;
  String? _playerAId;
  String? _playerBId;
  bool _hasText = false;

  @override
  void initState() {
    super.initState();
    _chatController.addListener(() {
      final hasText = _chatController.text.trim().isNotEmpty;
      if (hasText != _hasText) setState(() => _hasText = hasText);
    });
    _socketService = DuelRoomSocketService(baseUrl: widget.baseUrl, accessToken: widget.accessToken);
    _socketService.connect(
      duelId: widget.duelId,
      onConnected: () => setState(() => _connected = true),
      onDisconnected: () => setState(() => _connected = false),
      onDuelState: (state) {
        final playersJson = Map<String, dynamic>.from(state['players'] as Map);
        setState(() {
          _status = state['status'] as String;
          _readyUserIds = List<String>.from(state['readyUserIds'] as List);
          _players = playersJson.map(
            (id, info) => MapEntry(id, DuelPlayerInfo.fromJson(Map<String, dynamic>.from(info))),
          );
          final ids = _players.keys.toList();
          _playerAId = ids.isNotEmpty ? ids.first : null;
          _playerBId = ids.length > 1 ? ids[1] : null;
        });
      },
      onPlayerReady: (readyIds) {
        final newlyReady = readyIds.where((id) => !_readyUserIds.contains(id));
        for (final id in newlyReady) {
          _addSystemEvent('${_players[id]?.pseudo ?? 'Un joueur'} est prêt 👍');
        }
        setState(() => _readyUserIds = readyIds);
      },
      onBothReady: () {
        setState(() => _bothReady = true);
        _addSystemEvent('Les deux joueurs sont prêts — vous pouvez lancer le duel');
      },
      onDuelStarted: (status) {
        setState(() => _status = status);
        _addSystemEvent('Le duel a commencé 🔥');
        _startCapture();
      },
      onChatMessage: (message) => _addTimelineItem(message),
      onChatHistory: (history) {
        setState(() {
          _timeline.removeWhere((item) => item is ChatMessage);
          _timeline.insertAll(0, history);
        });
        _scrollToBottom();
      },
      onError: (message) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message))),
    );
  }

  void _addSystemEvent(String text) => _addTimelineItem(SystemEvent(text, DateTime.now()));

  void _addTimelineItem(Object item) {
    setState(() => _timeline.add(item));
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_chatScrollController.hasClients) {
        _chatScrollController.animateTo(
          _chatScrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  void dispose() {
    _socketService.dispose();
    _captureSub?.cancel();
    _captureController.dispose();
    _chatController.dispose();
    _chatScrollController.dispose();
    super.dispose();
  }

  Future<void> _startCapture() async {
    // Depuis Android 14+, la boîte de dialogue système de capture d'écran
    // (MediaProjection) propose "Écran entier" OU "Une seule application".
    // Si l'utilisateur choisit "Une seule application" — ou si le système la
    // pré-sélectionne — la capture ne verra JAMAIS le jeu (eFootball/CODM)
    // affiché derrière la bulle, puisque seule l'app sélectionnée est
    // projetée : chaque capture échoue en timeout côté OverlayBubbleService
    // (aucun frame reçu), sans que rien côté code ne puisse forcer ce choix
    // à la place de l'utilisateur — c'est une décision système. On prévient
    // donc explicitement AVANT que la boîte de dialogue système ne s'ouvre.
    if (Platform.isAndroid && mounted) {
      final proceed = await showDialog<bool>(
        context: context,
        barrierDismissible: false,
        builder: (context) => AlertDialog(
          title: const Text('Important avant de continuer'),
          content: const Text(
            'Le prochain écran va te demander d\'autoriser la capture. '
            'Choisis bien "Écran entier" (pas "Cette application") — sinon '
            'la capture de ton score échouera à chaque fois.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Compris, continuer'),
            ),
          ],
        ),
      );
      if (proceed != true || !mounted) return;
    }
    _captureSub = _captureController.status.listen((s) => setState(() => _captureStatus = s));
    try {
      final ok = await _captureController.start(
        duelId: widget.duelId,
        baseUrl: widget.baseUrl,
        accessToken: widget.accessToken,
      );
      if (!ok && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Capture d\'écran refusée — active-la pour envoyer ton score.')),
        );
      }
    } on PlatformException catch (e) {
      if (!mounted) return;
      if (e.code == 'OVERLAY_PERMISSION_MISSING') {
        // La bulle ne peut pas s'afficher sans cette permission distincte de
        // celle de capture d'écran — on guide directement vers l'écran où
        // elle se configure, plutôt que de laisser l'utilisateur deviner
        // pourquoi rien ne s'affiche à l'écran.
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: const Text('Autorise l\'affichage par-dessus les autres apps pour voir la bulle.'),
            action: SnackBarAction(
              label: 'Configurer',
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => DeviceSetupScreen(apiClient: _userClient)),
              ),
            ),
            duration: const Duration(seconds: 6),
          ),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message ?? 'Échec de la capture')));
      }
    }
  }

  bool get _iAmReady => _readyUserIds.contains(widget.currentUserId);

  void _sendMessage() {
    final text = _chatController.text.trim();
    if (text.isEmpty) return;
    _socketService.sendMessage(widget.duelId, text);
    _chatController.clear();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Salon de duel'),
        actions: [
          // Inviter un adversaire n'a de sens que tant que le salon attend
          // encore un second joueur (_playerBId == null) — cf. DuelsService.join
          // côté back-end qui refuse un salon déjà complet.
          if (_playerBId == null)
            IconButton(
              icon: const Icon(Icons.share_rounded),
              tooltip: 'Partager le salon',
              onPressed: () => shareDuelInvite(
                context: context,
                baseUrl: widget.baseUrl,
                duelId: widget.duelId,
                joinCode: widget.joinCode,
              ),
            ),
        ],
      ),
      body: Column(
        children: [
          CaptureStatusBanner(
            status: _captureStatus,
            onConfirmSendIos: _captureStatus == CaptureStatus.screenshotDetected
                ? _captureController.confirmIosSend
                : null,
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                PlayerCard(
                  player: _playerAId != null ? _players[_playerAId] : null,
                  isReady: _playerAId != null && _readyUserIds.contains(_playerAId),
                  isMe: _playerAId == widget.currentUserId,
                ),
                const SizedBox(width: 12),
                const Icon(Icons.bolt, size: 28),
                const SizedBox(width: 12),
                PlayerCard(
                  player: _playerBId != null ? _players[_playerBId] : null,
                  isReady: _playerBId != null && _readyUserIds.contains(_playerBId),
                  isMe: _playerBId == widget.currentUserId,
                ),
              ],
            ),
          ),
          const Divider(height: 1),
          if (!_connected)
            Container(
              width: double.infinity,
              color: VuelColors.red.withValues(alpha: 0.12),
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2, color: VuelColors.red)),
                  SizedBox(width: 8),
                  Text('Connexion perdue — reconnexion en cours…', style: TextStyle(color: VuelColors.red, fontSize: 11)),
                ],
              ),
            ),
          Expanded(
            child: _timeline.isEmpty
                ? Center(
                    child: Padding(
                      padding: const EdgeInsets.all(24),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text('💬', style: TextStyle(fontSize: 30)),
                          const SizedBox(height: 8),
                          const Text(
                            'Aucun message pour l\'instant',
                            style: TextStyle(color: VuelColors.text, fontSize: 13, fontWeight: FontWeight.w600),
                          ),
                          const SizedBox(height: 4),
                          const Text(
                            'Dis bonjour à ton adversaire 👋',
                            style: TextStyle(color: VuelColors.muted, fontSize: 12),
                            textAlign: TextAlign.center,
                          ),
                        ],
                      ),
                    ),
                  )
                : ListView.builder(
                    controller: _chatScrollController,
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    itemCount: _timeline.length,
                    itemBuilder: (context, i) {
                      final item = _timeline[i];
                      if (item is SystemEvent) {
                        return _SystemEventPill(event: item);
                      }
                      final message = item as ChatMessage;
                      return ChatBubble(
                        message: message,
                        isMe: message.userId == widget.currentUserId,
                        sender: _players[message.userId],
                      );
                    },
                  ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _chatController,
                      maxLength: 300,
                      minLines: 1,
                      maxLines: 4,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        hintText: 'Message…',
                        counterText: '',
                      ),
                      onSubmitted: (_) => _sendMessage(),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Container(
                    decoration: BoxDecoration(
                      color: _hasText ? VuelColors.amber : VuelColors.surface2,
                      shape: BoxShape.circle,
                    ),
                    child: IconButton(
                      icon: Icon(Icons.send_rounded, color: _hasText ? const Color(0xFF412402) : VuelColors.muted),
                      onPressed: _hasText ? _sendMessage : null,
                    ),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _iAmReady ? null : () => _socketService.markReady(widget.duelId),
                    icon: Icon(_iAmReady ? Icons.check_circle : Icons.thumb_up_outlined),
                    label: Text(_iAmReady ? 'Prêt !' : 'Je suis prêt'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _bothReady && _status == 'OPEN'
                        ? () => _socketService.startDuel(widget.duelId)
                        : null,
                    icon: const Icon(Icons.play_arrow),
                    label: const Text('Lancer'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Petite pastille centrée pour les événements système ('X est prêt', 'Le
/// duel a commencé') — visuellement distincte des bulles de tchat pour que
/// l'œil distingue immédiatement un message d'un événement de salon.
class _SystemEventPill extends StatelessWidget {
  final SystemEvent event;
  const _SystemEventPill({required this.event});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 16),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
          decoration: BoxDecoration(
            color: VuelColors.surface2,
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            event.text,
            textAlign: TextAlign.center,
            style: const TextStyle(color: VuelColors.muted, fontSize: 11, fontWeight: FontWeight.w500),
          ),
        ),
      ),
    );
  }
}
