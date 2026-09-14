import 'dart:convert';
import 'package:http/http.dart' as http;
import 'api_errors.dart';
import 'authorized_request.dart';

class DuelsApiClient {
  final String baseUrl;
  final String Function() getAccessToken;
  /// Appelé automatiquement si une requête renvoie 401 (accessToken expiré) —
  /// voir `sendWithAutoRefresh`. Passer `Session.refreshAccessToken` ici pour
  /// que l'utilisateur n'ait pas à se reconnecter manuellement.
  final Future<bool> Function()? onUnauthorized;

  DuelsApiClient({required this.baseUrl, required this.getAccessToken, this.onUnauthorized});

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${getAccessToken()}',
      };

  Future<http.Response> _send(Future<http.Response> Function() doRequest) =>
      sendWithAutoRefresh(doRequest, onUnauthorized);

  /// Message clair et spécifique à partir d'une réponse d'erreur du serveur
  /// (celui-ci renvoie déjà un texte précis, ex: "Solde insuffisant pour
  /// lancer ce duel : il manque 150 F..." — cf. EscrowService côté back-end).
  /// On ne se contente plus de dumper le code HTTP brut.
  String _serverErrorMessage(http.Response res) {
    try {
      final body = jsonDecode(res.body);
      final msg = body is Map ? body['message'] : null;
      if (msg is List && msg.isNotEmpty) return msg.join(', ');
      if (msg is String && msg.isNotEmpty) return msg;
    } catch (_) {
      // réponse non-JSON — repli ci-dessous
    }
    if (res.statusCode == 401) return 'Session expirée — reconnecte-toi.';
    if (res.statusCode >= 500) return 'Le serveur rencontre un problème. Réessaie dans un instant.';
    return 'Une erreur est survenue (code ${res.statusCode}).';
  }

  Future<List<dynamic>> list({String? game}) => runApiCall(() async {
        final uri = Uri.parse('$baseUrl/duels').replace(queryParameters: game != null ? {'game': game} : null);
        final res = await _send(() => http.get(uri, headers: _headers));
        if (res.statusCode >= 400) throw Exception(_serverErrorMessage(res));
        return jsonDecode(res.body) as List<dynamic>;
      });

  Future<Map<String, dynamic>> getDetail(String duelId) => runApiCall(() async {
        final res = await _send(() => http.get(Uri.parse('$baseUrl/duels/$duelId'), headers: _headers));
        if (res.statusCode >= 400) throw Exception(_serverErrorMessage(res));
        return jsonDecode(res.body) as Map<String, dynamic>;
      });

  /// [mode] attendu par le back-end au format libre (ex: '1v1') — cf. CreateDuelDto.
  /// [stakeAmount] doit être >= 200 (mise personnalisée, minimum validé aussi côté back-end).
  /// [playerATeam] : nom de l'équipe du créateur pour ce duel — utilisé par le bot OCR
  /// pour analyser le résultat en fin de match (cf. OcrProcessor côté back-end).
  /// Optionnel : pertinent UNIQUEMENT pour EFOOTBALL (cf. CreateDuelDto côté
  /// back-end, qui ignore/rejette ce champ pour les autres jeux) — ne pas
  /// l'envoyer pour CODM/LUDO.
  Future<Map<String, dynamic>> create({
    required String game,
    required String mode,
    required int stakeAmount,
    String? playerATeam,
  }) =>
      runApiCall(() async {
        final res = await _send(() => http.post(
              Uri.parse('$baseUrl/duels'),
              headers: _headers,
              body: jsonEncode({
                'game': game,
                'mode': mode,
                'stakeAmount': stakeAmount,
                if (playerATeam != null) 'playerATeam': playerATeam,
              }),
            ));
        if (res.statusCode >= 400) throw Exception(_serverErrorMessage(res));
        return jsonDecode(res.body) as Map<String, dynamic>;
      });

  /// [playerBTeam] : nom de l'équipe du joueur qui rejoint, même rôle que
  /// [create]'s playerATeam. Optionnel : requis côté back-end uniquement si
  /// le duel rejoint est EFOOTBALL (cf. JoinDuelDto / DuelsService.join) —
  /// ne pas l'envoyer sinon (et surtout pas une chaîne vide, qui échouerait
  /// à la validation de longueur minimale).
  Future<void> join(String duelId, {String? playerBTeam}) => runApiCall(() async {
        final res = await _send(() => http.post(
              Uri.parse('$baseUrl/duels/$duelId/join'),
              headers: _headers,
              body: jsonEncode({if (playerBTeam != null) 'playerBTeam': playerBTeam}),
            ));
        if (res.statusCode >= 400) throw Exception(_serverErrorMessage(res));
      });

  Future<void> cancel(String duelId) => runApiCall(() async {
        final res = await _send(() => http.post(Uri.parse('$baseUrl/duels/$duelId/cancel'), headers: _headers));
        if (res.statusCode >= 400) throw Exception(_serverErrorMessage(res));
      });
}
