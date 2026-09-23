import 'package:flutter/foundation.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../api/push_api_client.dart';

/// Handler appelé par le système quand un message FCM arrive alors que l'app
/// est en arrière-plan OU complètement tuée — DOIT être une fonction de
/// premier niveau (pas une méthode d'instance), c'est une contrainte de
/// Firebase Messaging (isolate séparé). `@pragma('vm:entry-point')` empêche
/// le compilateur Flutter de la supprimer en mode release (tree-shaking) —
/// sans cette annotation, ça fonctionnerait en debug mais planterait
/// silencieusement en build release.
///
/// En pratique, on n'a RIEN à faire ici : PushDeliveryService (back-end)
/// envoie systématiquement un payload avec un bloc `notification` (titre +
/// corps), pas seulement `data` — FCM affiche alors la notification système
/// tout seul, y compris app tuée, sans passer par ce handler ni par
/// flutter_local_notifications (qui ne sert qu'au cas foreground, cf.
/// PushService._showForegroundNotification ci-dessous). Ce handler est gardé
/// vide plutôt que supprimé : Firebase râle (et échoue silencieusement à
/// enregistrer le handler background) si `onBackgroundMessage` n'est jamais
/// appelé au démarrage de l'app.
@pragma('vm:entry-point')
Future<void> firebaseMessagingBackgroundHandler(RemoteMessage message) async {}

/// Miroir mobile de la section "PUSH (comme WhatsApp)" de pwa/index.html —
/// permission, récupération/rotation du token, et affichage en foreground
/// (le seul cas où Android n'affiche PAS la notification tout seul).
class PushService {
  static final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();
  static bool _initialized = false;
  static bool _listenersAttached = false;

  /// Statut courant SANS déclencher de dialogue système — utilisé par
  /// NotificationPermissionBanner pour décider s'il doit s'afficher, sans
  /// re-solliciter l'utilisateur juste pour vérifier où il en est.
  static Future<AuthorizationStatus> currentStatus() async {
    try {
      final settings = await FirebaseMessaging.instance.getNotificationSettings();
      return settings.authorizationStatus;
    } catch (_) {
      return AuthorizationStatus.notDetermined;
    }
  }

  /// À appeler après connexion (cf. HomeShell.initState) ET depuis le bouton
  /// de NotificationPermissionBanner (l'utilisateur peut retenter après avoir
  /// refusé une première fois) — jamais bloquant pour le reste de l'app :
  /// toute erreur (permission refusée, pas de Google Play Services sur
  /// l'appareil, etc.) est avalée après avoir laissé l'app fonctionner
  /// normalement sans push, exactement comme `subscribeToPushIfPossible()`
  /// côté PWA. Idempotent : peut être rappelée plusieurs fois sans dupliquer
  /// les listeners (cf. `_listenersAttached`).
  static Future<AuthorizationStatus> requestAndRegister(PushApiClient pushClient) async {
    try {
      final messaging = FirebaseMessaging.instance;
      final settings = await messaging.requestPermission(alert: true, badge: true, sound: true);
      debugPrint('[Push] Permission demandée — statut : ${settings.authorizationStatus}');
      if (settings.authorizationStatus == AuthorizationStatus.denied) {
        return settings.authorizationStatus;
      }

      await _ensureLocalNotificationsInitialized();

      final token = await messaging.getToken();
      debugPrint('[Push] Token FCM : ${token != null ? "obtenu (${token.length} caractères)" : "NUL — Google Play Services indisponible ?"}');
      if (token != null) {
        await pushClient.registerDevice(token).then(
              (_) => debugPrint('[Push] Token enregistré côté back-end.'),
              onError: (e) => debugPrint('[Push] Échec enregistrement token côté back-end : $e'),
            );
      }

      if (!_listenersAttached) {
        _listenersAttached = true;
        // Le token FCM peut être régénéré par le SDK (rotation, réinstall) à
        // tout moment pendant que l'app tourne — sans ce listener, l'appareil
        // arrêterait silencieusement de recevoir des push jusqu'au prochain
        // redémarrage complet de l'app.
        messaging.onTokenRefresh.listen((newToken) {
          pushClient.registerDevice(newToken).catchError((e) => debugPrint('[Push] Échec ré-enregistrement token : $e'));
        });

        // Foreground uniquement : Android/iOS n'affichent PAS nativement la
        // notification système quand l'app est déjà au premier plan (à la
        // différence du cas background/tué, géré nativement — voir le handler
        // ci-dessus) — flutter_local_notifications comble cet écart pour un
        // comportement uniforme, comme WhatsApp qui notifie même app ouverte
        // sur un autre écran.
        FirebaseMessaging.onMessage.listen(_showForegroundNotification);
      }

      return settings.authorizationStatus;
    } catch (e) {
      // Best-effort — voir commentaire de la méthode. Le debugPrint permet
      // quand même de diagnostiquer en dev (ex: `flutter run`, pas
      // `build apk`) sans jamais faire planter ou bloquer l'app pour l'utilisateur.
      debugPrint('[Push] Initialisation échouée — notifications désactivées pour cette session : $e');
      return AuthorizationStatus.notDetermined;
    }
  }

  /// À appeler à la déconnexion (cf. HomeShell logout callback) — désenregistre
  /// le token courant côté back-end pour qu'un autre compte connecté ensuite
  /// sur ce même appareil ne reçoive pas les push du compte précédent.
  static Future<void> unregister(PushApiClient pushClient) async {
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await pushClient.unregisterDevice(token);
    } catch (_) {
      // Jamais bloquant pour la déconnexion elle-même.
    }
  }

  static Future<void> _ensureLocalNotificationsInitialized() async {
    if (_initialized) return;
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    await _localNotifications.initialize(const InitializationSettings(android: androidInit));
    // Doit correspondre à `default_notification_channel_id` déclaré dans
    // AndroidManifest_service.xml — sinon Android crée un canal séparé sans
    // nom lisible pour les notifs affichées via ce plugin (foreground).
    const channel = AndroidNotificationChannel(
      'vuel_notifications',
      'Notifications Vuel',
      description: 'Dépôts, retraits, résultats de duels et litiges',
      importance: Importance.high,
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);
    _initialized = true; // seulement après succès : un échec ne bloque plus les tentatives suivantes
  }

  static void _showForegroundNotification(RemoteMessage message) {
    final notification = message.notification;
    if (notification == null) return;
    _localNotifications.show(
      notification.hashCode,
      notification.title,
      notification.body,
      const NotificationDetails(
        android: AndroidNotificationDetails(
          'vuel_notifications',
          'Notifications Vuel',
          channelDescription: 'Dépôts, retraits, résultats de duels et litiges',
          importance: Importance.high,
          priority: Priority.high,
        ),
      ),
    );
  }
}
