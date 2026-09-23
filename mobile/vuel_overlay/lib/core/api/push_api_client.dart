import 'dart:convert';
import 'package:http/http.dart' as http;
import 'authorized_request.dart';

/// Miroir mobile de `subscribeToPushIfPossible()`/le désabonnement Web Push
/// côté pwa/index.html — sauf qu'ici le "endpoint" est un token FCM plutôt
/// qu'une URL de push service, cf. UserNotificationsController
/// (POST/DELETE /notifications/push/register-device) côté back-end.
class PushApiClient {
  final String baseUrl;
  final String Function() getAccessToken;
  final Future<bool> Function()? onUnauthorized;

  PushApiClient({required this.baseUrl, required this.getAccessToken, this.onUnauthorized});

  Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ${getAccessToken()}',
      };

  Future<http.Response> _send(Future<http.Response> Function() doRequest) =>
      sendWithAutoRefresh(doRequest, onUnauthorized);

  /// Appelé au démarrage de l'app (une fois connecté) et à chaque rotation du
  /// token FCM (cf. PushService.init, listener onTokenRefresh) — upsert côté
  /// serveur, jamais bloquant si ça échoue (voir PushService, appel non-awaité
  /// avec catch silencieux).
  Future<void> registerDevice(String token) async {
    final res = await _send(() => http.post(
          Uri.parse('$baseUrl/notifications/push/register-device'),
          headers: _headers,
          body: jsonEncode({'token': token, 'platform': 'ANDROID'}),
        ));
    if (res.statusCode >= 400) throw Exception('Échec d\'enregistrement du token push: ${res.statusCode}');
  }

  /// Appelé à la déconnexion — sans ça, un autre joueur se connectant ensuite
  /// sur le même appareil recevrait encore les push du compte précédent.
  Future<void> unregisterDevice(String token) async {
    await _send(() => http.delete(
          Uri.parse('$baseUrl/notifications/push/register-device'),
          headers: _headers,
          body: jsonEncode({'token': token}),
        ));
    // Pas de vérification du status ici : la déconnexion doit se terminer
    // même si ce nettoyage échoue (ex: pas de réseau à ce moment précis).
  }
}

