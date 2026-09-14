import 'package:flutter/material.dart';
import '../models/duel_room_models.dart';
import '../../../core/widgets/player_avatar.dart';

class PlayerCard extends StatelessWidget {
  final DuelPlayerInfo? player;
  final bool isReady;
  final bool isMe;

  const PlayerCard({super.key, required this.player, required this.isReady, required this.isMe});

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Card(
        color: isReady ? Colors.green.withOpacity(0.1) : null,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            children: [
              PlayerAvatar(pseudo: player?.pseudo, avatarId: player?.avatarId, radius: 22),
              const SizedBox(height: 8),
              Text(player?.pseudo ?? 'En attente…', style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(
                player?.gamingId != null ? 'ID : ${player!.gamingId}' : '—',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              const SizedBox(height: 8),
              Icon(
                isReady ? Icons.check_circle : Icons.hourglass_empty,
                color: isReady ? Colors.green : Colors.grey,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
