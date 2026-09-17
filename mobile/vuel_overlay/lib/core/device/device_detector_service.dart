import 'dart:io';
import 'package:device_info_plus/device_info_plus.dart';

/// Résultat de la détection, envoyé ensuite au back-end via PATCH /users/me.
class DetectedDevice {
  final String os; // 'android' | 'ios'
  final String brand;
  final String model;

  const DetectedDevice({required this.os, required this.brand, required this.model});

  Map<String, String> toJson() => {
        'deviceOs': os,
        'deviceBrand': brand,
        'deviceModel': model,
      };
}

/// Lit les infos système dès l'ouverture du formulaire d'inscription pour
/// pré-remplir automatiquement marque/modèle (cf. cahier des charges 3.1.B).
class DeviceDetectorService {
  final DeviceInfoPlugin _plugin = DeviceInfoPlugin();

  Future<DetectedDevice> detect() async {
    if (Platform.isAndroid) {
      final info = await _plugin.androidInfo;
      return DetectedDevice(
        os: 'android',
        brand: _normalizeAndroidBrand(info.manufacturer, info.brand),
        model: info.model,
      );
    }
    if (Platform.isIOS) {
      final info = await _plugin.iosInfo;
      return DetectedDevice(
        os: 'ios',
        brand: 'Apple',
        model: info.utsname.machine, // ex: "iPhone13,2" — à mapper vers un nom lisible si besoin
      );
    }
    return const DetectedDevice(os: 'unknown', brand: 'Autre', model: 'Inconnu');
  }

  /// Aligne le nom de fabricant brut sur la liste du formulaire d'inscription
  /// (Samsung, Apple, Tecno, Infinix, Xiaomi, Huawei, Oppo, Realme, Vivo, Honor, Itel, Autre).
  String _normalizeAndroidBrand(String manufacturer, String brand) {
    final raw = manufacturer.toLowerCase();
    const known = [
      'samsung',
      'tecno',
      'infinix',
      'xiaomi',
      'huawei',
      'oppo',
      'realme',
      'vivo',
      'honor',
      'itel',
    ];
    for (final name in known) {
      if (raw.contains(name)) {
        return name[0].toUpperCase() + name.substring(1);
      }
    }
    // Redmi/POCO/Redmi Note sont commercialisés sous Xiaomi
    if (raw.contains('redmi') || raw.contains('poco')) return 'Xiaomi';
    return 'Autre';
  }
}
