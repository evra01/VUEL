import 'dart:convert';
import 'package:http/http.dart' as http;
import 'authorized_request.dart';

class TournamentsApiClient {
  final String baseUrl;
  final String Function() getAccessToken;
  /// Appelé automatiquement si une requête renvoie 401 (accessToken expiré) —
  /// voir `sendWithAutoRefresh`. Passer `Session.refreshAccessToken` ici pour
  /// que l'utilisateur n'ait pas à se reconnecter manuellement.
  final Future<bool> Function()? onUnauthorized;

  TournamentsApiClient({required this.baseUrl, required this.getAccessToken, this.onUnauthorized});

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${getAccessToken()}',
      };

  Future<http.Response> _send(Future<http.Response> Function() doRequest) =>
      sendWithAutoRefresh(doRequest, onUnauthorized);

  Future<List<dynamic>> list({String? game}) async {
    final uri = Uri.parse('$baseUrl/tournaments').replace(queryParameters: game != null ? {'game': game} : null);
    final res = await _send(() => http.get(uri, headers: _headers));
    if (res.statusCode >= 400) throw Exception('Échec de récupération des tournois: ${res.statusCode}');
    return jsonDecode(res.body) as List<dynamic>;
  }

  Future<Map<String, dynamic>> getDetail(String tournamentId) async {
    final res = await _send(() => http.get(Uri.parse('$baseUrl/tournaments/$tournamentId'), headers: _headers));
    if (res.statusCode >= 400) throw Exception('Échec de récupération du tournoi: ${res.statusCode}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// [stakeAmount] doit être >= 200 (mise minimum, validée aussi côté back-end).
  Future<Map<String, dynamic>> create({
    required String name,
    required String game,
    required int stakeAmount,
    required int maxParticipants,
  }) async {
    final res = await _send(() => http.post(
          Uri.parse('$baseUrl/tournaments'),
          headers: _headers,
          body: jsonEncode({'name': name, 'game': game, 'stakeAmount': stakeAmount, 'maxParticipants': maxParticipants}),
        ));
    if (res.statusCode >= 400) throw Exception('Échec de création du tournoi: ${res.statusCode} ${res.body}');
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// Débite la mise du wallet immédiatement (fonds déjà déposés) — pas de nouveau
  /// paiement Wave à ce stade.
  Future<void> join(String tournamentId) async {
    final res = await _send(() => http.post(Uri.parse('$baseUrl/tournaments/$tournamentId/join'), headers: _headers));
    if (res.statusCode >= 400) throw Exception('Échec d\'inscription: ${res.statusCode} ${res.body}');
  }

  /// Réservé à l'organisateur du tournoi — génère le bracket du round 1.
  Future<void> start(String tournamentId) async {
    final res = await _send(() => http.post(Uri.parse('$baseUrl/tournaments/$tournamentId/start'), headers: _headers));
    if (res.statusCode >= 400) throw Exception('Échec du démarrage: ${res.statusCode} ${res.body}');
  }

  /// Réservé à l'organisateur — rembourse tous les participants (mise recréditée
  /// sur leur wallet) et annule le tournoi.
  Future<void> cancel(String tournamentId) async {
    final res = await _send(() => http.post(Uri.parse('$baseUrl/tournaments/$tournamentId/cancel'), headers: _headers));
    if (res.statusCode >= 400) throw Exception('Échec de l\'annulation: ${res.statusCode} ${res.body}');
  }
}
