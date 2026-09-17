import 'dart:convert';
import 'package:http/http.dart' as http;
import 'api_errors.dart';
import 'authorized_request.dart';

/// Bannières promo affichées en haut de l'écran d'accueil (cf. AccueilTab).
/// Pas de endpoint d'upload ici — la gestion (upload/activation/ordre) se
/// fait uniquement depuis la page admin (pwa/admin.html), jamais depuis
/// l'app joueur.
class BannersApiClient {
  final String baseUrl;
  final String Function() getAccessToken;
  final Future<bool> Function()? onUnauthorized;

  BannersApiClient({required this.baseUrl, required this.getAccessToken, this.onUnauthorized});

  Map<String, String> get headers => {'Authorization': 'Bearer ${getAccessToken()}'};

  Future<http.Response> _send(Future<http.Response> Function() doRequest) =>
      sendWithAutoRefresh(doRequest, onUnauthorized);

  Future<List<dynamic>> list() => runApiCall(() async {
        final res = await _send(() => http.get(Uri.parse('$baseUrl/banners'), headers: headers));
        if (res.statusCode >= 400) return <dynamic>[];
        return jsonDecode(res.body) as List<dynamic>;
      });

  /// URL de l'image d'une bannière — à passer à Image.network(url,
  /// headers: headers) : l'endpoint exige le token (JwtAuthGuard côté
  /// back-end), un <Image> classique sans en-tête échouerait en 401.
  String imageUrl(String bannerId) => '$baseUrl/banners/$bannerId/image';
}
