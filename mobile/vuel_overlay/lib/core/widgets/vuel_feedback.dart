import 'package:flutter/material.dart';

import '../theme/vuel_theme.dart';

/// Point d'entrée unique pour tous les messages d'alerte/erreur/succès de
/// l'app — avant cet ajout, chaque écran affichait ses propres SnackBar/
/// AlertDialog "à la main" (`ScaffoldMessenger.of(context).showSnackBar(
/// SnackBar(content: Text(...)))`), sans icône, sans code couleur cohérent
/// (une erreur réseau et une confirmation de succès avaient exactement le
/// même look neutre), et avec des styles de dialogue de confirmation
/// légèrement différents d'un écran à l'autre.
///
/// Utilisation :
///   VuelFeedback.error(context, 'Message');
///   VuelFeedback.success(context, 'Message');
///   VuelFeedback.warning(context, 'Message');
///   final ok = await VuelFeedback.confirm(context, title: '...', message: '...');
class VuelFeedback {
  VuelFeedback._();

  static void error(BuildContext context, String message) {
    _showSnackBar(context, message: message, icon: Icons.error_rounded, accent: VuelColors.red);
  }

  static void success(BuildContext context, String message) {
    _showSnackBar(context, message: message, icon: Icons.check_circle_rounded, accent: VuelColors.green);
  }

  static void warning(BuildContext context, String message) {
    _showSnackBar(context, message: message, icon: Icons.info_rounded, accent: VuelColors.amber);
  }

  static void _showSnackBar(
    BuildContext context, {
    required String message,
    required IconData icon,
    required Color accent,
  }) {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          // Le reste (forme, position flottante, couleur de fond neutre) vient
          // du SnackBarThemeData global (voir core/theme/vuel_theme.dart) — on
          // ne personnalise ici que ce qui distingue le type de message :
          // liseré + icône de la couleur associée (rouge/vert/ambre).
          content: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: accent, size: 20),
              const SizedBox(width: 12),
              Expanded(child: Text(message)),
            ],
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(12),
            side: BorderSide(color: accent.withValues(alpha: 0.4), width: 1),
          ),
        ),
      );
  }

  /// Boîte de dialogue de confirmation stylée, à la place d'un AlertDialog
  /// construit à la main dans chaque écran. `danger: true` passe le bouton de
  /// confirmation en rouge (actions destructrices : annuler un tournoi,
  /// supprimer un compte...).
  static Future<bool> confirm(
    BuildContext context, {
    required String title,
    required String message,
    String confirmLabel = 'Confirmer',
    String cancelLabel = 'Annuler',
    bool danger = false,
  }) async {
    final accent = danger ? VuelColors.red : VuelColors.amber;
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: Icon(danger ? Icons.warning_rounded : Icons.help_rounded, color: accent, size: 32),
        title: Text(title),
        content: Text(message),
        actionsAlignment: MainAxisAlignment.spaceBetween,
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: Text(cancelLabel, style: const TextStyle(color: VuelColors.muted)),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: accent, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text(confirmLabel),
          ),
        ],
      ),
    );
    return result ?? false;
  }
}
