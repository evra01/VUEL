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

/// Canaux par lesquels le code OTP est effectivement parti — renvoyé par
/// AuthService.register côté back-end. Le code est envoyé par SMS *et* par email
/// quand une adresse est fournie ; si l'un des deux échoue, l'inscription
/// continue avec l'autre, d'où l'intérêt de savoir lequel a marché pour
/// l'afficher à l'utilisateur.
class OtpDelivery {
  final bool sms;
  final bool email;

  /// Adresse email tronquée par le serveur (ex: "jo***@gmail.com").
  final String? maskedEmail;

  OtpDelivery({required this.sms, required this.email, this.maskedEmail});

  factory OtpDelivery.fromJson(Map<String, dynamic> json) {
    final channels = json['channels'] as Map<String, dynamic>?;
    return OtpDelivery(
      // Défaut prudent : les anciennes versions du back-end ne renvoyaient pas
      // `channels` et n'envoyaient que le SMS.
      sms: channels?['sms'] as bool? ?? true,
      email: channels?['email'] as bool? ?? false,
      maskedEmail: json['email'] as String?,
    );
  }
}

class AuthApiClient {
  final String baseUrl;

  AuthApiClient({required this.baseUrl});

  Map<String, String> get _headers => {'Content-Type': 'application/json'};

  /// Étape 1 de l'inscription — envoie un OTP à la fois par SMS et par email
  /// (ou l'affiche dans le terminal du back-end en dev, cf. SmsService /
  /// EmailService). Le compte n'existe pas encore : il n'est créé qu'après
  /// [verifyOtp].
  Future<OtpDelivery> register({
    required String phone,
    required String pseudo,
    required String email,
    required String password,
  }) async {
    final res = await http.post(
      Uri.parse('$baseUrl/auth/register'),
      headers: _headers,
      body: jsonEncode({
        'phone': phone,
        'pseudo': pseudo,
        'email': email,
        'password': password,
      }),
    );
    if (res.statusCode >= 400) {
      throw Exception(_extractMessage(res.body) ?? 'Échec de l\'inscription (${res.statusCode})');
    }
    return OtpDelivery.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
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
