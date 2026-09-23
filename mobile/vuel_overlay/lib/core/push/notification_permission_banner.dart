import 'package:flutter/material.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/push_api_client.dart';
import '../theme/vuel_theme.dart';
import 'push_service.dart';

/// Bannière "Active les notifications" affichée sur l'écran d'accueil tant
/// que la permission n'est pas accordée — ajoutée parce que la demande
/// automatique au premier lancement (cf. HomeShell.initState →
/// PushService.requestAndRegister) ne suffit pas toujours : sur certains
/// appareils/versions d'Android, le dialogue système peut être manqué,
/// refusé par réflexe, ou l'app peut avoir été mise à jour APRÈS un premier
/// refus (l'utilisateur n'a alors plus jamais l'occasion de revenir dessus
/// sans creuser dans les réglages du téléphone).
///
/// Se masque automatiquement dès que la permission est accordée, et reste
/// masquée après un "×" explicite (persisté via shared_preferences) pour ne
/// pas harceler quelqu'un qui a délibérément choisi de refuser.
class NotificationPermissionBanner extends StatefulWidget {
  final PushApiClient pushClient;
  const NotificationPermissionBanner({super.key, required this.pushClient});

  @override
  State<NotificationPermissionBanner> createState() => _NotificationPermissionBannerState();
}

class _NotificationPermissionBannerState extends State<NotificationPermissionBanner> {
  static const _dismissedKey = 'notif_banner_dismissed';

  bool _loading = true;
  bool _dismissed = false;
  bool _permanentlyDenied = false; // true = Android ne réaffichera plus le dialogue système lui-même
  AuthorizationStatus _status = AuthorizationStatus.notDetermined;
  bool _requesting = false;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    final prefs = await SharedPreferences.getInstance();
    final status = await PushService.currentStatus();
    // PermissionStatus.permanentlyDenied ne concerne que le "vrai" runtime
    // permission Android (permission_handler) — FirebaseMessaging ne fait pas
    // cette distinction lui-même, d'où ce deuxième contrôle pour savoir si le
    // bouton doit rouvrir les réglages plutôt que retenter le dialogue.
    final permStatus = await Permission.notification.status;
    if (!mounted) return;
    setState(() {
      _dismissed = prefs.getBool(_dismissedKey) ?? false;
      _status = status;
      _permanentlyDenied = permStatus.isPermanentlyDenied;
      _loading = false;
    });
  }

  Future<void> _dismiss() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_dismissedKey, true);
    if (mounted) setState(() => _dismissed = true);
  }

  Future<void> _enable() async {
    setState(() => _requesting = true);
    try {
      if (_permanentlyDenied) {
        // Aucune app ne peut réafficher le dialogue système une fois qu'Android
        // considère la permission "définitivement refusée" — seul le menu
        // réglages du téléphone le permet.
        await openAppSettings();
        // Pas de _refresh() immédiat ici : l'utilisateur part sur l'écran
        // réglages, donc rien à re-vérifier avant qu'il ne revienne dans l'app
        // (cf. WidgetsBindingObserver ci-dessous serait l'idéal, mais un
        // simple retour manuel sur cet écran déclenche déjà un rebuild via
        // didChangeDependencies au prochain accès à l'onglet Accueil).
      } else {
        final status = await PushService.requestAndRegister(widget.pushClient);
        if (mounted) setState(() => _status = status);
      }
    } finally {
      if (mounted) setState(() => _requesting = false);
      await _refresh();
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _dismissed || _status == AuthorizationStatus.authorized || _status == AuthorizationStatus.provisional) {
      return const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.only(bottom: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: VuelColors.surface,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: VuelColors.amber.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('🔔', style: TextStyle(fontSize: 22)),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Active les notifications',
                  style: TextStyle(color: VuelColors.text, fontSize: 13, fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 3),
                const Text(
                  'Ne rate aucun dépôt validé, retrait traité ou résultat de duel.',
                  style: TextStyle(color: VuelColors.muted, fontSize: 12),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    GestureDetector(
                      onTap: _requesting ? null : _enable,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                        decoration: BoxDecoration(color: VuelColors.amber, borderRadius: BorderRadius.circular(20)),
                        child: _requesting
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFF412402)),
                              )
                            : Text(
                                _permanentlyDenied ? 'Ouvrir les réglages' : 'Activer',
                                style: const TextStyle(color: Color(0xFF412402), fontSize: 12, fontWeight: FontWeight.w700),
                              ),
                      ),
                    ),
                    const SizedBox(width: 10),
                    GestureDetector(
                      onTap: _dismiss,
                      child: const Text('Plus tard', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
                    ),
                  ],
                ),
              ],
            ),
          ),
          GestureDetector(
            onTap: _dismiss,
            child: const Padding(
              padding: EdgeInsets.only(left: 4),
              child: Icon(Icons.close, color: VuelColors.muted, size: 18),
            ),
          ),
        ],
      ),
    );
  }
}
