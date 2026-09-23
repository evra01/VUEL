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

class _NotificationPermissionBannerState extends State<NotificationPermissionBanner> with WidgetsBindingObserver {
  // Timestamp (ms) du dernier « Plus tard / × ». Avant : un booléen définitif — un seul
  // tap sur « × » masquait la bannière À VIE, sans autre endroit dans l'app pour
  // activer les notifications. Désormais elle revient après quelques jours.
  static const _dismissedAtKey = 'notif_banner_dismissed_at';
  static const _dismissDuration = Duration(days: 3);

  bool _loading = true;
  bool _dismissed = false;
  bool _permanentlyDenied = false; // true = Android ne réaffichera plus le dialogue système lui-même
  AuthorizationStatus _status = AuthorizationStatus.notDetermined;
  bool _requesting = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // Au retour des réglages du téléphone (ou d'un dialogue système), on relit l'état
  // et, si la permission vient d'être accordée, on enregistre enfin le token FCM —
  // sans ça, activer les notifications depuis les réglages ne servait à rien
  // tant que l'app n'était pas complètement relancée.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refresh(registerIfGranted: true);
  }

  Future<void> _refresh({bool registerIfGranted = false}) async {
    final prefs = await SharedPreferences.getInstance();
    var status = await PushService.currentStatus();
    if (registerIfGranted &&
        (status == AuthorizationStatus.authorized || status == AuthorizationStatus.provisional)) {
      status = await PushService.requestAndRegister(widget.pushClient);
    }
    // PermissionStatus.permanentlyDenied ne concerne que le "vrai" runtime
    // permission Android (permission_handler) — FirebaseMessaging ne fait pas
    // cette distinction lui-même, d'où ce deuxième contrôle pour savoir si le
    // bouton doit rouvrir les réglages plutôt que retenter le dialogue.
    final permStatus = await Permission.notification.status;
    if (!mounted) return;
    setState(() {
      final dismissedAt = prefs.getInt(_dismissedAtKey);
      _dismissed = dismissedAt != null &&
          DateTime.now().difference(DateTime.fromMillisecondsSinceEpoch(dismissedAt)) < _dismissDuration;
      _status = status;
      _permanentlyDenied = permStatus.isPermanentlyDenied && status == AuthorizationStatus.denied;
      _loading = false;
    });
  }

  Future<void> _dismiss() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt(_dismissedAtKey, DateTime.now().millisecondsSinceEpoch);
    if (mounted) setState(() => _dismissed = true);
  }

  Future<void> _enable() async {
    setState(() => _requesting = true);
    try {
      if (_permanentlyDenied) {
        await openAppSettings();
        return;
      }
      final status = await PushService.requestAndRegister(widget.pushClient);
      if (!mounted) return;
      setState(() => _status = status);
      // Le dialogue système n'a rien donné (refusé, ou Android ne le réaffiche plus
      // et renvoie « denied » immédiatement) : au lieu de ne rien faire — le bouton
      // semblait « mort » —, on ouvre directement les réglages de l'app.
      if (status != AuthorizationStatus.authorized && status != AuthorizationStatus.provisional) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Autorise les notifications dans les réglages de Vuel.')),
          );
        }
        await openAppSettings();
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
