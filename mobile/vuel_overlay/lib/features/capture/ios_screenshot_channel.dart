import 'package:flutter/services.dart';

/// Pont vers ScreenshotWatcherPlugin (Swift) — flux "notification intelligente" iOS.
class IosScreenshotChannel {
  static const _method = MethodChannel('vuel/screenshot_watcher');
  static const _events = EventChannel('vuel/screenshot_watcher/status');

  Future<void> startWatching({required String duelId, required String baseUrl, required String accessToken}) {
    return _method.invokeMethod('startWatching', {
      'duelId': duelId,
      'baseUrl': baseUrl,
      'accessToken': accessToken,
    });
  }

  Future<void> stopWatching() => _method.invokeMethod('stopWatching');

  /// L'utilisateur confirme l'envoi (ex: tap sur la notification locale) → va chercher
  /// la dernière capture dans la photothèque et l'upload.
  Future<void> confirmSend() => _method.invokeMethod('confirmSend');

  /// Émet : screenshot_detected, stale_screenshot_rejected, uploading, uploaded, upload_failed, capture_failed
  Stream<String> get statusStream => _events.receiveBroadcastStream().map((e) => e as String);
}
