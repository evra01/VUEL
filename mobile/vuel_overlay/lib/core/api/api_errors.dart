import 'dart:async';
import 'dart:io';
import 'package:http/http.dart' as http;

/// Traduit une erreur réseau/HTTP en message clair et spécifique — plutôt
/// que de laisser fuiter un texte technique générique ("problème de
/// connexion", `SocketException`, exception brute Dart) jusqu'à
/// l'utilisateur. À utiliser dans chaque `catch` d'appel API :
///
///   try {
///     ...
///   } on Object catch (e) {
///     throw Exception(describeApiError(e));
///   }
///
/// Les clients API construisent déjà des `Exception` avec un message clair
/// quand ils LISENT une réponse HTTP en erreur (cf. duels_api_client.dart) —
/// cette fonction couvre le cas où l'appel échoue avant même d'obtenir une
/// réponse (pas de réseau, DNS, timeout, hôte injoignable).
String describeApiError(Object error) {
  if (error is SocketException) {
    return 'Pas de connexion internet — vérifie ton réseau et réessaie.';
  }
  if (error is TimeoutException) {
    return 'Le serveur met trop de temps à répondre. Réessaie dans un instant.';
  }
  if (error is http.ClientException) {
    // Regroupe la plupart des échecs bas niveau du package http (connexion
    // refusée, hôte introuvable, connexion coupée en cours de requête...).
    return 'Impossible de contacter le serveur — vérifie ta connexion internet.';
  }
  final message = error.toString();
  if (message.startsWith('Exception: ')) return message.substring('Exception: '.length);
  return message;
}

/// Exécute [action] et enveloppe toute erreur réseau bas niveau dans un
/// message clair, tout en laissant passer telles quelles les `Exception`
/// déjà porteuses d'un message spécifique (ex: erreur renvoyée par le
/// serveur avec son propre texte).
Future<T> runApiCall<T>(Future<T> Function() action) async {
  try {
    return await action();
  } on SocketException {
    throw Exception('Pas de connexion internet — vérifie ton réseau et réessaie.');
  } on TimeoutException {
    throw Exception('Le serveur met trop de temps à répondre. Réessaie dans un instant.');
  } on http.ClientException {
    throw Exception('Impossible de contacter le serveur — vérifie ta connexion internet.');
  }
}
