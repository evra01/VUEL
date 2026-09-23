import 'dart:convert';
import 'package:http/http.dart' as http;
import '../device/device_detector_service.dart';
import 'authorized_request.dart';

class UserApiClient {
  final String baseUrl; // ex: https://api.vuel.app
  final String Function() getAccessToken;
  /// Appelé automatiquement si une requête renvoie 401 (accessToken expiré) —
  /// voir `sendWithAutoRefresh`. Passer `Session.refreshAccessToken` ici pour
  /// que l'utilisateur n'ait pas à se reconnecter manuellement.
  final Future<bool> Function()? onUnauthorized;

  UserApiClient({required this.baseUrl, required this.getAccessToken, this.onUnauthorized});

  Future<http.Response> _send(Future<http.Response> Function() doRequest) =>
      sendWithAutoRefresh(doRequest, onUnauthorized);

  Future<void> syncDeviceInfo(DetectedDevice device) async {
    final res = await _send(() => http.patch(
          Uri.parse('$baseUrl/users/me'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${getAccessToken()}',
          },
          body: jsonEncode(device.toJson()),
        ));
    if (res.statusCode >= 400) {
      throw Exception('Échec de synchronisation device info: ${res.statusCode}');
    }
  }

  Future<Map<String, dynamic>> getProfile() async {
    final res = await _send(() => http.get(
          Uri.parse('$baseUrl/users/me'),
          headers: {'Authorization': 'Bearer ${getAccessToken()}'},
        ));
    if (res.statusCode >= 400) {
      throw Exception('Échec de récupération du profil: ${res.statusCode}');
    }
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  /// [game] attendu au format back-end : 'EFOOTBALL' | 'CODM' | 'LUDO'.
  Future<void> addGamingId({required String game, required String gamePseudo, String? favoriteTeam}) async {
    final res = await _send(() => http.post(
          Uri.parse('$baseUrl/users/me/gaming-ids'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${getAccessToken()}',
          },
          body: jsonEncode({
            'game': game,
            'gamePseudo': gamePseudo,
            if (favoriteTeam != null && favoriteTeam.isNotEmpty) 'favoriteTeam': favoriteTeam,
          }),
        ));
    if (res.statusCode >= 400) {
      throw Exception('Échec d\'ajout de l\'ID de jeu: ${res.statusCode}');
    }
  }

  Future<void> setAvatar(String avatarId) async {
    final res = await _send(() => http.patch(
          Uri.parse('$baseUrl/users/me/avatar'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${getAccessToken()}',
          },
          body: jsonEncode({'avatarId': avatarId}),
        ));
    if (res.statusCode >= 400) {
      throw Exception('Échec de mise à jour de l\'avatar: ${res.statusCode}');
    }
  }
}
