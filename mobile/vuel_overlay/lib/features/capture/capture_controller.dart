import 'dart:async';
import 'dart:io';
import 'bubble_capture_channel.dart';
import 'ios_screenshot_channel.dart';

enum CaptureStatus { idle, capturing, uploading, uploaded, failed, screenshotDetected }

/// Point d'entrée unique pour l'écran de duel : démarre le bon mécanisme de
/// capture selon la plateforme dès que le duel passe en IN_PROGRESS, l'arrête
/// à la fin. cf. cahier des charges 3.4.
class CaptureController {
  final _bubble = BubbleCaptureChannel();
  final _iosWatcher = IosScreenshotChannel();

  final _statusController = StreamController<CaptureStatus>.broadcast();
  Stream<CaptureStatus> get status => _statusController.stream;

  StreamSubscription? _sub;

  Future<bool> start({required String duelId, required String baseUrl, required String accessToken}) async {
    if (Platform.isAndroid) {
      final granted = await _bubble.start(duelId: duelId, baseUrl: baseUrl, accessToken: accessToken);
      if (!granted) return false;
      _sub = _bubble.statusStream.listen((event) => _statusController.add(_mapStatus(event)));
      return true;
    }
    if (Platform.isIOS) {
      await _iosWatcher.startWatching(duelId: duelId, baseUrl: baseUrl, accessToken: accessToken);
      _sub = _iosWatcher.statusStream.listen((event) => _statusController.add(_mapStatus(event)));
      return true;
    }
    return false;
  }

  /// iOS uniquement : à appeler quand l'utilisateur confirme l'envoi de la capture détectée.
  Future<void> confirmIosSend() => _iosWatcher.confirmSend();

  Future<void> stop() async {
    await _sub?.cancel();
    if (Platform.isAndroid) await _bubble.stop();
    if (Platform.isIOS) await _iosWatcher.stopWatching();
  }

  void dispose() {
    _sub?.cancel();
    _statusController.close();
  }

  CaptureStatus _mapStatus(String event) {
    switch (event) {
      case 'capturing':
        return CaptureStatus.capturing;
      case 'screenshot_detected':
        return CaptureStatus.screenshotDetected;
      case 'uploading':
        return CaptureStatus.uploading;
      case 'uploaded':
        return CaptureStatus.uploaded;
      default:
        return CaptureStatus.failed;
    }
  }
}
