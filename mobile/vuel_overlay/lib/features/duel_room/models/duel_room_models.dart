class DuelPlayerInfo {
  final String pseudo;
  final String? gamingId;
  final String? avatarId;

  DuelPlayerInfo({required this.pseudo, this.gamingId, this.avatarId});

  factory DuelPlayerInfo.fromJson(Map<String, dynamic> json) => DuelPlayerInfo(
        pseudo: json['pseudo'] as String,
        gamingId: json['gamingId'] as String?,
        avatarId: json['avatarId'] as String?,
      );
}

class ChatMessage {
  final String userId;
  final String message;
  final DateTime sentAt;

  ChatMessage({required this.userId, required this.message, required this.sentAt});

  factory ChatMessage.fromJson(Map<String, dynamic> json) => ChatMessage(
        userId: json['userId'] as String,
        message: json['message'] as String,
        sentAt: DateTime.parse(json['sentAt'] as String),
      );
}

/// Événement de salon affiché en ligne dans le fil de discussion (pas envoyé
/// par le serveur — généré côté client à partir des événements socket comme
/// 'player_ready' ou 'duel_started') pour rendre le tchat plus vivant et
/// informatif, plutôt qu'un simple flux de messages texte isolé du contexte.
class SystemEvent {
  final String text;
  final DateTime at;
  SystemEvent(this.text, this.at);
}
