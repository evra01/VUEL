import 'dart:io';
import 'package:android_intent_plus/android_intent.dart';
import 'package:permission_handler/permission_handler.dart';

/// Chaque constructeur Android a sa propre couche de gestion d'énergie qui tue
/// les apps en arrière-plan (et donc la bulle flottante) si elle n'est pas
/// explicitement désactivée pour Vuel. On tente d'abord l'intent constructeur
/// dédié, avec repli sur l'écran standard Android si l'intent échoue.
class BatteryOptimizationService {
  static const _packageName = 'com.vuel.app'; // TODO: applicationId réel

  Future<bool> isIgnoringOptimizations() async {
    if (!Platform.isAndroid) return true;
    final status = await Permission.ignoreBatteryOptimizations.status;
    return status.isGranted;
  }

  /// [brand] doit correspondre aux valeurs normalisées de DeviceDetectorService
  /// (Samsung, Xiaomi, Huawei, Oppo, Realme, Vivo, Honor, Tecno, Infinix, Itel, Autre).
  Future<void> openBrandSettings(String brand) async {
    if (!Platform.isAndroid) return;

    final intent = _brandIntent(brand);
    if (intent != null) {
      try {
        await intent.launch();
        return;
      } catch (_) {
        // L'activité constructeur peut ne pas exister sur ce firmware précis → repli standard
      }
    }
    await _openStandardAndroidSettings();
  }

  AndroidIntent? _brandIntent(String brand) {
    switch (brand) {
      case 'Xiaomi':
        // MIUI : autoriser le démarrage automatique
        return const AndroidIntent(
          action: 'android.intent.action.MAIN',
          componentName: 'com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity',
        );
      case 'Huawei':
        return const AndroidIntent(
          action: 'android.intent.action.MAIN',
          componentName: 'com.huawei.systemmanager/com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity',
        );
      case 'Oppo':
      case 'Realme':
        // ColorOS / RealmeUI partagent la même app de gestion du démarrage
        return const AndroidIntent(
          action: 'android.intent.action.MAIN',
          componentName: 'com.coloros.safecenter/com.coloros.safecenter.permission.startup.StartupAppListActivity',
        );
      case 'Vivo':
        return const AndroidIntent(
          action: 'android.intent.action.MAIN',
          componentName: 'com.vivo.permissionmanager/com.vivo.permissionmanager.activity.BgStartUpManagerActivity',
        );
      case 'Samsung':
        // Device Care > Battery > Apps non surveillées (pas d'intent direct fiable sur toutes les versions)
        return const AndroidIntent(
          action: 'android.intent.action.MAIN',
          componentName: 'com.samsung.android.lool/com.samsung.android.sm.ui.battery.BatteryActivity',
        );
      case 'Tecno':
      case 'Infinix':
      case 'Itel':
        // HiOS/XOS (Tecno/Infinix) et Itel sont tous des OS Transsion, basés sur le même
        // "Phone Manager" pour la gestion du démarrage automatique.
        return const AndroidIntent(
          action: 'android.intent.action.MAIN',
          componentName: 'com.transsion.phonemanager/com.itel.autobootmanager.activity.AutoBootManagerActivity',
        );
      case 'Honor':
        // Depuis la scission Honor/Huawei, Honor a son propre package system manager
        return const AndroidIntent(
          action: 'android.intent.action.MAIN',
          componentName: 'com.hihonor.systemmanager/com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity',
        );
      default:
        return null; // écran standard Android en dessous
    }
  }

  Future<void> _openStandardAndroidSettings() async {
    final intent = AndroidIntent(
      action: 'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      data: 'package:$_packageName',
    );
    await intent.launch();
  }
}
