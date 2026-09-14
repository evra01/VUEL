import 'package:flutter/material.dart';

/// Icônes d'avatar prédéfinies fournies par l'app — le joueur en choisit une,
/// aucune photo n'est uploadée. Doit rester synchronisée avec AVATAR_ICON_IDS
/// côté back-end (backend/src/users/dto/users.dto.ts).
class AppAvatarIcons {
  static const Map<String, (IconData, Color)> all = {
    'flame': (Icons.local_fire_department, Color(0xFFF0A52A)),
    'trophy': (Icons.emoji_events, Color(0xFFE1C34B)),
    'bolt': (Icons.bolt, Color(0xFFF0A52A)),
    'target': (Icons.gps_fixed, Color(0xFFE14B3C)),
    'dice': (Icons.casino, Color(0xFF4B7BE1)),
    'shield': (Icons.shield, Color(0xFF5DCAA5)),
    'star': (Icons.star, Color(0xFFE1C34B)),
    'controller': (Icons.sports_esports, Color(0xFFB45DE1)),
  };

  static (IconData, Color) resolve(String? avatarId) {
    return all[avatarId] ?? (Icons.person, const Color(0xFF888780));
  }
}
