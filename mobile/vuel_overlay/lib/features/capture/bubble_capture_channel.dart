import 'package:flutter/services.dart';

/// Pont vers OverlayBubblePlugin (Kotlin) — capture via bulle flottante Android.
class BubbleCaptureChannel {
  static const _method = MethodChannel('vuel/overlay_bubble');
  static const _events = EventChannel('vuel/overlay_bubble/status');

  /// Ouvre le dialog système MediaProjection puis démarre le service de bulle.
  /// Retourne false si l'utilisateur refuse la capture d'écran, OU si la
  /// permission "Affichage par-dessus les autres applications" (SYSTEM_ALERT_WINDOW,
  /// gérée séparément dans DeviceSetupScreen) n'a pas encore été accordée —
  /// dans ce dernier cas, [PlatformException.message] contient un texte
  /// exploitable directement pour l'utilisateur (voir OverlayBubblePlugin.kt).
  Future<bool> start({required String duelId, required String baseUrl, required String accessToken}) async {
    try {
      final granted = await _method.invokeMethod<bool>('requestMediaProjection', {
        'duelId': duelId,
        'baseUrl': baseUrl,
        'accessToken': accessToken,
      });
      return granted ?? false;
    } on PlatformException catch (e) {
      if (e.code == 'OVERLAY_PERMISSION_MISSING') rethrow;
      return false;
    }
  }

  Future<void> stop() => _method.invokeMethod('stopBubble');

  /// Émet : capturing, uploading, uploaded, upload_failed, capture_failed
  Stream<String> get statusStream => _events.receiveBroadcastStream().map((e) => e as String);
}
