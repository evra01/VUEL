import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/auth_api_client.dart';

/// État global de session — équivalent du localStorage utilisé par la PWA
/// (clés 'vuel_api_base' et le token JWT). Persisté via shared_preferences
/// pour survivre au redémarrage de l'app.
class Session extends ChangeNotifier {
  static const _kApiBase = 'vuel_api_base';
  static const _kAccessToken = 'vuel_access_token';
  static const _kRefreshToken = 'vuel_refresh_token';

  /// Adresse par défaut : le back-end Vuel déployé sur Render. Peut être
  /// changée dans l'écran de connexion (ex: pour pointer vers un serveur local
  /// pendant le développement).
  String apiBaseUrl = 'https://vuel.onrender.com';
  String? accessToken;
  String? refreshToken;

  bool _loaded = false;
  bool get loaded => _loaded;
  bool get isLoggedIn => accessToken != null;

  // Empêche deux refresh concurrents (ex: 3 appels API en parallèle prennent
  // tous un 401 en même temps) de partir chacun faire leur propre appel
  // /auth/refresh — le premier fait le travail, les autres attendent son
  // résultat via ce Future partagé.
  Future<bool>? _refreshInFlight;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    apiBaseUrl = prefs.getString(_kApiBase) ?? apiBaseUrl;
    accessToken = prefs.getString(_kAccessToken);
    refreshToken = prefs.getString(_kRefreshToken);
    _loaded = true;
    notifyListeners();
  }

  Future<void> setApiBaseUrl(String url) async {
    apiBaseUrl = url.trim().replaceAll(RegExp(r'/$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kApiBase, apiBaseUrl);
    notifyListeners();
  }

  /// À appeler juste après login/verify-otp/refresh — stocke les DEUX tokens
  /// (avant, seul l'accessToken était gardé : le refreshToken renvoyé par le
  /// serveur était généré puis jeté, donc totalement inutilisable une fois
  /// l'accessToken expiré, 15 min plus tard).
  Future<void> setTokens({required String accessToken, required String refreshToken}) async {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kAccessToken, accessToken);
    await prefs.setString(_kRefreshToken, refreshToken);
    notifyListeners();
  }

  Future<void> logout() async {
    accessToken = null;
    refreshToken = null;
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_kAccessToken);
    await prefs.remove(_kRefreshToken);
    notifyListeners();
  }

  /// À utiliser comme `getAccessToken` par les clients API (UserApiClient,
  /// WalletApiClient, etc. attendent tous `String Function()`, pas un Future).
  String getAccessTokenOrEmpty() => accessToken ?? '';

  /// Tente d'échanger le refreshToken stocké contre une nouvelle paire de
  /// tokens. Utilisé par les clients API (cf. `onUnauthorized` dans
  /// DuelsApiClient/WalletApiClient/etc.) quand une requête renvoie 401 —
  /// c'est ce mécanisme qui évite d'avoir à se reconnecter manuellement
  /// simplement parce que l'app est restée quelques minutes en arrière-plan.
  /// Renvoie `false` (et vide la session) si le refreshToken est lui-même
  /// expiré ou invalide : dans ce cas, une reconnexion manuelle est
  /// réellement nécessaire.
  Future<bool> refreshAccessToken(AuthApiClient authClient) {
    return _refreshInFlight ??= _doRefresh(authClient).whenComplete(() => _refreshInFlight = null);
  }

  Future<bool> _doRefresh(AuthApiClient authClient) async {
    final currentRefreshToken = refreshToken;
    if (currentRefreshToken == null) return false;
    try {
      final tokens = await authClient.refresh(currentRefreshToken);
      await setTokens(accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
      return true;
    } catch (_) {
      await logout();
      return false;
    }
  }
}
