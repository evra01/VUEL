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
      CaptureStatus.failed => ('Échec de l\'envoi — réessaie', Icons.error, Colors.red),
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
