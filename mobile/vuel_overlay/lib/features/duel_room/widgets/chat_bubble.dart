import 'package:flutter/material.dart';
import '../../../core/theme/vuel_theme.dart';
import '../../../core/widgets/player_avatar.dart';
import '../models/duel_room_models.dart';

class ChatBubble extends StatelessWidget {
  final ChatMessage message;
  final bool isMe;
  final DuelPlayerInfo? sender;

  const ChatBubble({super.key, required this.message, required this.isMe, this.sender});

  String _formatTime(DateTime dt) {
    final local = dt.toLocal();
    return '${local.hour.toString().padLeft(2, '0')}:${local.minute.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    final bubbleColor = isMe ? VuelColors.amberDim : VuelColors.surface2;
    final textColor = isMe ? VuelColors.amber : VuelColors.text;

    final bubble = Container(
      constraints: const BoxConstraints(maxWidth: 260),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: BoxDecoration(
        color: bubbleColor,
        borderRadius: BorderRadius.only(
          topLeft: const Radius.circular(16),
          topRight: const Radius.circular(16),
          bottomLeft: Radius.circular(isMe ? 16 : 4),
          bottomRight: Radius.circular(isMe ? 4 : 16),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message.message, style: TextStyle(color: textColor, fontSize: 13.5, height: 1.3)),
          const SizedBox(height: 3),
          Text(
            _formatTime(message.sentAt),
            style: const TextStyle(color: VuelColors.muted, fontSize: 9.5),
          ),
        ],
      ),
    );

    if (isMe) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 10),
        child: Row(mainAxisAlignment: MainAxisAlignment.end, children: [bubble]),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3, horizontal: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          PlayerAvatar(pseudo: sender?.pseudo, avatarId: sender?.avatarId, radius: 13),
          const SizedBox(width: 6),
          Flexible(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (sender?.pseudo != null)
                  Padding(
                    padding: const EdgeInsets.only(left: 4, bottom: 2),
                    child: Text(sender!.pseudo, style: const TextStyle(color: VuelColors.muted, fontSize: 10.5, fontWeight: FontWeight.w600)),
                  ),
                bubble,
              ],
            ),
          ),
        ],
      ),
    );
  }
}
