import 'dart:io';
import 'package:android_intent_plus/android_intent.dart';
import 'package:permission_handler/permission_handler.dart';

/// Gère la permission SYSTEM_ALERT_WINDOW nécessaire à la bulle flottante
/// utilisée en fin de match pour capturer et envoyer le score (cf. 3.4).
class OverlayPermissionService {
  Future<bool> isGranted() async {
    if (!Platform.isAndroid) return false;
    final status = await Permission.systemAlertWindow.status;
    return status.isGranted;
  }

  /// Ouvre directement l'écran système "Afficher par-dessus les autres applications"
  /// pour l'app Vuel — l'utilisateur doit activer manuellement le switch.
  Future<void> openSettings() async {
    if (!Platform.isAndroid) return;
    final intent = AndroidIntent(
      action: 'android.settings.action.MANAGE_OVERLAY_PERMISSION',
      data: 'package:com.vuel.app', // TODO: remplacer par l'applicationId réel
    );
    await intent.launch();
  }

  Future<bool> request() async {
    if (await isGranted()) return true;
    await openSettings();
    // La permission overlay ne peut pas être accordée via un dialog standard :
    // il faut re-vérifier isGranted() au retour sur l'app (ex: WidgetsBindingObserver.didChangeAppLifecycleState).
    return isGranted();
  }
}
