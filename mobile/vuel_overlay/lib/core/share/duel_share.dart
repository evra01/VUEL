import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';

const Map<String, String> _gameLabels = {
  'EFOOTBALL': 'eFootball',
  'CODM': 'Call of Duty Mobile',
  'LUDO': 'Ludo',
};

/// Ouvre la feuille de partage native (SMS, WhatsApp, etc.) avec un message
/// prêt à l'emploi pour inviter un ami à rejoindre un salon de duel —
/// pointant vers la page d'invitation publique `/d/:code` servie par le
/// back-end (cf. DuelInviteController), qui tente d'ouvrir l'app et affiche
/// sinon le code à coller dans "Rejoindre avec un code" (cf. PlayTab).
///
/// Le lien utilise `joinCode` (code court du salon, ex: "K7QX2M", cf.
/// DuelsService.generateJoinCode) plutôt que l'UUID technique du duel — plus
/// simple à lire, dicter ou recopier à la main. `duelId` sert uniquement de
/// repli pour les salons créés avant l'ajout de ce champ (joinCode == null).
Future<void> shareDuelInvite({
  required BuildContext context,
  required String baseUrl,
  required String duelId,
  String? joinCode,
  String? game,
  int? stakeAmount,
}) async {
  final gameLabel = _gameLabels[game] ?? game ?? 'Vuel';
  final stakeText = stakeAmount != null ? ' (mise $stakeAmount F)' : '';
  final code = joinCode ?? duelId;
  final link = '$baseUrl/d/$code';

  final message = 'Rejoins mon duel $gameLabel$stakeText sur Vuel 🎮⚡\n$link';

  final box = context.findRenderObject() as RenderBox?;
  await Share.share(
    message,
    subject: 'Invitation à un duel Vuel',
    sharePositionOrigin: box != null ? box.localToGlobal(Offset.zero) & box.size : null,
  );
}
