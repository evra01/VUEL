import 'package:flutter/material.dart';
import '../../core/device/device_detector_service.dart';
import '../../core/permissions/overlay_permission_service.dart';
import '../../core/permissions/battery_optimization_service.dart';
import '../../core/api/user_api_client.dart';
import 'data/brand_tutorials_data.dart';
import 'widgets/tutorial_step_card.dart';

/// Écran affiché juste après l'inscription (cf. cahier des charges 3.1.B) :
/// 1. Détecte automatiquement OS/marque/modèle et les envoie au back-end
/// 2. Affiche le tutoriel visuel adapté à la marque détectée
/// 3. Guide l'utilisateur pour activer l'overlay et désactiver l'optimisation batterie
class DeviceSetupScreen extends StatefulWidget {
  final UserApiClient apiClient;

  const DeviceSetupScreen({super.key, required this.apiClient});

  @override
  State<DeviceSetupScreen> createState() => _DeviceSetupScreenState();
}

class _DeviceSetupScreenState extends State<DeviceSetupScreen> with WidgetsBindingObserver {
  final _detector = DeviceDetectorService();
  final _overlayPermission = OverlayPermissionService();
  final _batteryOptimization = BatteryOptimizationService();

  DetectedDevice? _device;
  bool _overlayGranted = false;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _init();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  // L'utilisateur revient sur l'app après être passé par les paramètres système :
  // on re-vérifie l'état de la permission overlay à ce moment-là.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshOverlayStatus();
    }
  }

  Future<void> _init() async {
    final device = await _detector.detect();
    try {
      await widget.apiClient.syncDeviceInfo(device);
    } catch (_) {
      // TODO: gérer l'échec réseau (retry / mode offline) sans bloquer le setup
    }
    final overlayGranted = await _overlayPermission.isGranted();
    setState(() {
      _device = device;
      _overlayGranted = overlayGranted;
      _loading = false;
    });
  }

  Future<void> _refreshOverlayStatus() async {
    final granted = await _overlayPermission.isGranted();
    if (mounted) setState(() => _overlayGranted = granted);
  }

  @override
  Widget build(BuildContext context) {
    if (_loading || _device == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    final tutorial = BrandTutorialsData.forBrand(_device!.brand);

    return Scaffold(
      appBar: AppBar(title: const Text('Configuration de ton appareil')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'Appareil détecté : ${_device!.brand} ${_device!.model}',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 16),

          Text('1. Active la bulle flottante', style: Theme.of(context).textTheme.titleSmall),
          const Text('Elle te permet d\'envoyer ton score en un clic à la fin d\'un duel.'),
          for (var i = 0; i < tutorial.overlaySteps.length; i++)
            TutorialStepCard(step: tutorial.overlaySteps[i], index: i),
          const SizedBox(height: 8),
          FilledButton.icon(
            onPressed: _overlayGranted ? null : _overlayPermission.request,
            icon: Icon(_overlayGranted ? Icons.check_circle : Icons.layers),
            label: Text(_overlayGranted ? 'Bulle activée' : 'Activer la bulle flottante'),
          ),

          const SizedBox(height: 24),
          Text('2. Désactive l\'optimisation batterie', style: Theme.of(context).textTheme.titleSmall),
          const Text('Sans ça, ton téléphone peut fermer Vuel en arrière-plan pendant un match.'),
          for (var i = 0; i < tutorial.batterySteps.length; i++)
            TutorialStepCard(step: tutorial.batterySteps[i], index: i),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => _batteryOptimization.openBrandSettings(_device!.brand),
            icon: const Icon(Icons.battery_saver),
            label: const Text('Ouvrir les réglages batterie'),
          ),

          const SizedBox(height: 32),
          FilledButton(
            onPressed: _overlayGranted ? () => Navigator.of(context).pop() : null,
            child: const Text('Continuer'),
          ),
        ],
      ),
    );
  }
}
