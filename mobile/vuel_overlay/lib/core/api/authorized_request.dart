import 'package:http/http.dart' as http;

/// Exécute [doRequest] (un appel http.get/post/patch déjà entièrement
/// configuré, y compris ses headers d'auth) et, si le serveur répond 401
/// (accessToken expiré — 15 min, cf. AuthService.issueTokens côté back-end),
/// tente [onUnauthorized] (typiquement `Session.refreshAccessToken`) puis
/// rejoue UNE FOIS la requête avec le nouveau token.
///
/// [doRequest] doit relire le token à chaque appel (ex: via un header
/// construit par un getter `_headers`, pas une valeur capturée une fois pour
/// toutes) pour que le retry utilise bien le token fraîchement rafraîchi.
///
/// Sans [onUnauthorized] (ou s'il échoue), la requête garde son statut 401
/// d'origine — c'est aux clients API d'en faire un message clair (cf.
/// `_serverErrorMessage` dans DuelsApiClient : "Session expirée —
/// reconnecte-toi.").
Future<http.Response> sendWithAutoRefresh(
  Future<http.Response> Function() doRequest,
  Future<bool> Function()? onUnauthorized,
) async {
  final res = await doRequest();
  if (res.statusCode != 401 || onUnauthorized == null) return res;

  final refreshed = await onUnauthorized();
  if (!refreshed) return res;

  return doRequest();
}
