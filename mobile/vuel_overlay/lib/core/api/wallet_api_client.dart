import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';
import 'authorized_request.dart';

class WalletApiClient {
  final String baseUrl;
  final String Function() getAccessToken;
  /// Appelé automatiquement si une requête renvoie 401 (accessToken expiré) —
  /// voir `sendWithAutoRefresh`. Passer `Session.refreshAccessToken` ici pour
  /// que l'utilisateur n'ait pas à se reconnecter manuellement.
  final Future<bool> Function()? onUnauthorized;

  WalletApiClient({required this.baseUrl, required this.getAccessToken, this.onUnauthorized});

  Future<http.Response> _send(Future<http.Response> Function() doRequest) =>
      sendWithAutoRefresh(doRequest, onUnauthorized);

  /// Requête POST générique avec extraction d'un message d'erreur exploitable
  /// depuis une réponse NestJS ({statusCode, message, error}) plutôt que
  /// d'afficher juste "Échec ... 403" — utile notamment pour "KYC requis
  /// avant tout retrait" ou "Solde insuffisant".
  String _errorMessage(http.Response res, String fallback) {
    try {
      final body = jsonDecode(res.body);
      final msg = body is Map ? body['message'] : null;
      if (msg is String) return msg;
      if (msg is List && msg.isNotEmpty) return msg.first.toString();
    } catch (_) {
      // Corps non-JSON (erreur réseau/proxy) — on garde le message générique.
    }
    return '$fallback (${res.statusCode})';
  }

  /// Demande le lien de paiement Wave fixe pour [amount] FCFA, puis l'ouvre dans
  /// le navigateur du téléphone. [phoneNumber] est le numéro que le joueur va
  /// utiliser pour payer — indispensable pour qu'un admin retrouve le paiement
  /// reçu sur le compte Wave avant de valider manuellement le dépôt. Le solde
  /// se met à jour une fois le dépôt validé côté back-office/Telegram (PAS
  /// automatiquement) — l'app doit rafraîchir le wallet au retour au premier
  /// plan (ex: dans didChangeAppLifecycleState) plutôt que de supposer le
  /// paiement réussi immédiatement.
  Future<void> depositViaWave(int amount, String phoneNumber) async {
    final res = await _send(() => http.post(
          Uri.parse('$baseUrl/wallet/deposit'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${getAccessToken()}',
          },
          body: jsonEncode({'amount': amount, 'phoneNumber': phoneNumber}),
        ));

    if (res.statusCode >= 400) {
      throw Exception(_errorMessage(res, 'Échec de la création du dépôt'));
    }

    final body = jsonDecode(res.body) as Map<String, dynamic>;
    final paymentUrl = body['paymentUrl'] as String?;
    if (paymentUrl == null) {
      throw Exception('Réponse inattendue : pas de lien de paiement.');
    }

    final uri = Uri.parse(paymentUrl);
    if (!await launchUrl(uri, mode: LaunchMode.externalApplication)) {
      throw Exception('Impossible d\'ouvrir le lien de paiement Wave.');
    }
  }

  /// Demande un retrait de [amount] FCFA vers Wave (seul moyen de retrait
  /// disponible, cf. WithdrawDto côté back-end). Le montant est débité du
  /// solde disponible immédiatement ; l'envoi effectif de l'argent au joueur
  /// est validé manuellement par un admin (Telegram/back-office), comme pour
  /// les dépôts — cf. WalletService.withdraw. Aucun KYC requis.
  Future<void> withdraw(int amount, String provider) async {
    final res = await _send(() => http.post(
          Uri.parse('$baseUrl/wallet/withdraw'),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ${getAccessToken()}',
          },
          body: jsonEncode({'amount': amount, 'provider': provider}),
        ));

    if (res.statusCode >= 400) {
      throw Exception(_errorMessage(res, 'Échec de la demande de retrait'));
    }
  }

  Future<Map<String, dynamic>> getWallet() async {
    final res = await _send(() => http.get(
          Uri.parse('$baseUrl/wallet'),
          headers: {'Authorization': 'Bearer ${getAccessToken()}'},
        ));
    if (res.statusCode >= 400) {
      throw Exception('Échec de récupération du wallet: ${res.statusCode}');
    }
    return jsonDecode(res.body) as Map<String, dynamic>;
  }

  Future<List<dynamic>> getTransactions() async {
    final res = await _send(() => http.get(
          Uri.parse('$baseUrl/wallet/transactions'),
          headers: {'Authorization': 'Bearer ${getAccessToken()}'},
        ));
    if (res.statusCode >= 400) {
      throw Exception('Échec de récupération des transactions: ${res.statusCode}');
    }
    return jsonDecode(res.body) as List<dynamic>;
  }
}
