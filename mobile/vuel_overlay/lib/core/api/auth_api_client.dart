import 'dart:convert';
import 'package:http/http.dart' as http;

/// Résultat d'une connexion/inscription réussie — cf. AuthService.issueTokens
/// côté back-end (JwtService.sign, expiresIn 15m pour l'access token).
class AuthTokens {
  final String accessToken;
  final String refreshToken;

  AuthTokens({required this.accessToken, required this.refreshToken});

  factory AuthTokens.fromJson(Map<String, dynamic> json) => AuthTokens(
        accessToken: json['accessToken'] as String,
        refreshToken: json['refreshToken'] as String,
      );
}

class AuthApiClient {
  final String baseUrl;

  AuthApiClient({required this.baseUrl});

  Map<String, String> get _headers => {'Content-Type': 'application/json'};

  /// Étape 1 de l'inscription — envoie un OTP par SMS (ou l'affiche dans le
  /// terminal du back-end en dev, cf. SmsService). Le compte n'existe pas
  /// encore : il n'est créé qu'après [verifyOtp].
  Future<void> register({required String phone, required String pseudo, required String password}) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/register'),
      headers: _headers,
      body: jsonEncode({'phone': phone, 'pseudo': pseudo, 'password': password}),
    );
    if (res.statusCode >= 400) {
      throw Exception(_extractMessage(res.body) ?? 'Échec de l\'inscription (${res.statusCode})');
    }
  }

  Future<AuthTokens> verifyOtp({required String phone, required String code}) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/verify-otp'),
      headers: _headers,
      body: jsonEncode({'phone': phone, 'code': code}),
    );
    if (res.statusCode >= 400) {
      throw Exception(_extractMessage(res.body) ?? 'Code invalide (${res.statusCode})');
    }
    return AuthTokens.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  Future<AuthTokens> login({required String phone, required String password}) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/login'),
      headers: _headers,
      body: jsonEncode({'phone': phone, 'password': password}),
    );
    if (res.statusCode >= 400) {
      throw Exception(_extractMessage(res.body) ?? 'Identifiants invalides (${res.statusCode})');
    }
    return AuthTokens.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  /// Échange le refreshToken (30j) contre une nouvelle paire de tokens —
  /// appelé en silence par [Session.refreshAccessToken] dès qu'un appel API
  /// renvoie 401 (accessToken expiré, 15 min), pour éviter à l'utilisateur de
  /// retaper ses identifiants juste parce qu'il a laissé l'app quelques
  /// minutes en arrière-plan. Si le refreshToken lui-même est expiré (30j
  /// d'inactivité totale) ou invalide, le serveur renvoie 401 et l'appelant
  /// doit alors déconnecter l'utilisateur pour de bon.
  Future<AuthTokens> refresh(String refreshToken) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/refresh'),
      headers: _headers,
      body: jsonEncode({'refreshToken': refreshToken}),
    );
    if (res.statusCode >= 400) {
      throw Exception(_extractMessage(res.body) ?? 'Session expirée (${res.statusCode})');
    }
    return AuthTokens.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  /// Le back-end (ValidationPipe + filtres Nest) renvoie généralement
  /// {"message": "..."} ou {"message": ["...", "..."]} sur erreur — on essaie
  /// d'en extraire un texte lisible, sinon on retombe sur le code HTTP brut.
  String? _extractMessage(String body) {
    try {
      final decoded = jsonDecode(body);
      final message = decoded['message'];
      if (message is String) return message;
      if (message is List && message.isNotEmpty) return message.join(', ');
    } catch (_) {
      // Corps non-JSON (ex: proxy/erreur réseau) — on ignore, le code HTTP suffit.
    }
    return null;
  }
}
