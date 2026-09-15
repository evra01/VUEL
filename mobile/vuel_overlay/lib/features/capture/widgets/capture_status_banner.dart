import 'package:flutter/material.dart';
import '../capture_controller.dart';

class CaptureStatusBanner extends StatelessWidget {
  final CaptureStatus status;
  final VoidCallback? onConfirmSendIos; // affiché uniquement si screenshotDetected (iOS)

  const CaptureStatusBanner({super.key, required this.status, this.onConfirmSendIos});

  @override
  Widget build(BuildContext context) {
    if (status == CaptureStatus.idle) return const SizedBox.shrink();

    final (text, icon, color) = switch (status) {
      CaptureStatus.capturing => ('Capture en cours…', Icons.camera_alt, Colors.blue),
      CaptureStatus.screenshotDetected => ('Capture détectée — envoyer ce score ?', Icons.image, Colors.orange),
      CaptureStatus.uploading => ('Envoi de la preuve…', Icons.upload, Colors.blue),
      CaptureStatus.uploaded => ('Preuve envoyée ✓', Icons.check_circle, Colors.green),
      // Distinct de uploadFailed : ici la capture d'écran elle-même n'a pas
      // abouti (permission MediaProjection perdue, timeout du frame...) —
      // rien n'a encore été envoyé au serveur, inutile de parler d'"envoi".
      // Sur Android 14+, la cause la plus fréquente est le choix "Une seule
      // application" fait dans la boîte de dialogue système de capture
      // d'écran (au lieu de "Écran entier") — voir l'avertissement affiché
      // dans duel_room_screen._startCapture avant l'ouverture de ce dialog.
      // On le rappelle ici pour l'utilisateur qui relance une capture après
      // un premier échec sans forcément se souvenir de cet avertissement.
      CaptureStatus.captureFailed =>
        ('Échec de la capture — réessaie (choisis "Écran entier" si on te redemande la permission)',
            Icons.camera_alt, Colors.red),
      CaptureStatus.uploadFailed => ('Échec de l\'envoi — réessaie', Icons.error, Colors.red),
      CaptureStatus.staleScreenshotRejected =>
        ('Capture trop ancienne — reprends une capture fraîche du score', Icons.warning, Colors.orange),
      CaptureStatus.idle => ('', Icons.info, Colors.grey),
    };

    return Material(
      color: color.withOpacity(0.1),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        child: Row(
          children: [
            Icon(icon, color: color),
            const SizedBox(width: 8),
            Expanded(child: Text(text)),
            if (status == CaptureStatus.screenshotDetected && onConfirmSendIos != null)
              TextButton(onPressed: onConfirmSendIos, child: const Text('Envoyer')),
          ],
        ),
      ),
    );
  }
}
