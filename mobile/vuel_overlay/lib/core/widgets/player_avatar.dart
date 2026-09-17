import 'package:flutter/material.dart';
import '../assets/app_avatar_icons.dart' show AppAvatarIcons;

/// Affiche l'icône d'app choisie par le joueur (parmi AppAvatarIcons) si elle
/// existe, sinon un repli en initiales + couleur déterministe basée sur son
/// pseudo (le même pseudo donne toujours la même couleur, deux joueurs
/// différents ont donc des icônes visuellement distinctes).
class PlayerAvatar extends StatelessWidget {
  final String? pseudo;
  final String? avatarId; // ID parmi AppAvatarIcons.all — pas de photo uploadée
  final double radius;

  const PlayerAvatar({super.key, required this.pseudo, this.avatarId, this.radius = 20});

  static const _palette = [
    Color(0xFFF0A52A), // ambre Vuel
    Color(0xFF5DCAA5),
    Color(0xFFE14B3C),
    Color(0xFF4B7BE1),
    Color(0xFFB45DE1),
    Color(0xFFE1C34B),
  ];

  Color _colorFor(String seed) {
    final hash = seed.codeUnits.fold<int>(0, (acc, c) => acc + c);
    return _palette[hash % _palette.length];
  }

  String _initialsFor(String seed) {
    final parts = seed.trim().split(RegExp(r'[\s_.-]+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, parts.first.length.clamp(0, 2)).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    if (avatarId != null) {
      final (icon, color) = AppAvatarIcons.resolve(avatarId);
      return CircleAvatar(
        radius: radius,
        backgroundColor: color.withOpacity(0.18),
        child: Icon(icon, color: color, size: radius),
      );
    }

    final seed = pseudo?.isNotEmpty == true ? pseudo! : '?';
    return CircleAvatar(
      radius: radius,
      backgroundColor: _colorFor(seed).withOpacity(0.18),
      child: Text(
        _initialsFor(seed),
        style: TextStyle(
          color: _colorFor(seed),
          fontWeight: FontWeight.bold,
          fontSize: radius * 0.7,
        ),
      ),
    );
  }
}
