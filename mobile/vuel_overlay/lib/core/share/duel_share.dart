import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

const Map<String, String> _gameLabels = {
  'EFOOTBALL': 'eFootball',
  'CODM': 'Call of Duty Mobile',
  'LUDO': 'Ludo',
};

/// Ouvre la feuille de partage native (SMS, WhatsApp, etc.) avec un message
/// prêt à l'emploi pour inviter un ami à rejoindre un salon de duel —
/// pointant vers la page d'invitation publique `/d/:id` servie par le
/// back-end (cf. DuelInviteController), qui tente d'ouvrir l'app et affiche
/// sinon le code à coller dans "Rejoindre avec un code" (cf. PlayTab).
Future<void> shareDuelInvite({
  required BuildContext context,
  required String baseUrl,
  required String duelId,
  String? game,
  int? stakeAmount,
}) async {
  final gameLabel = _gameLabels[game] ?? game ?? 'Vuel';
  final stakeText = stakeAmount != null ? ' (mise $stakeAmount F)' : '';
  final link = '$baseUrl/d/$duelId';

  final message = 'Rejoins mon duel $gameLabel$stakeText sur Vuel 🎮⚡\n$link';

  final box = context.findRenderObject() as RenderBox?;
  await Share.share(
    message,
    subject: 'Invitation à un duel Vuel',
    sharePositionOrigin: box != null ? box.localToGlobal(Offset.zero) & box.size : null,
  );
}
