import '../models/brand_tutorial.dart';

/// Contenu éditorial des tutoriels — à compléter avec les vrais visuels
/// une fois les maquettes Figma disponibles (imageAsset sont des placeholders).
class BrandTutorialsData {
  static const Map<String, BrandTutorial> tutorials = {
    'Xiaomi': BrandTutorial(
      brand: 'Xiaomi',
      overlaySteps: [
        TutorialStep(
          title: 'Ouvrir les paramètres système',
          description: 'Va dans Paramètres > Applications > Vuel > Autorisations.',
          imageAsset: 'assets/tutorials/xiaomi_overlay_1.png',
        ),
        TutorialStep(
          title: 'Activer la bulle flottante',
          description: 'Active "Afficher au-dessus des autres applications".',
          imageAsset: 'assets/tutorials/xiaomi_overlay_2.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Autoriser le démarrage automatique',
          description: 'Dans Sécurité > Autorisations > Démarrage automatique, active Vuel.',
          imageAsset: 'assets/tutorials/xiaomi_battery_1.png',
        ),
      ],
    ),
    'Samsung': BrandTutorial(
      brand: 'Samsung',
      overlaySteps: [
        TutorialStep(
          title: 'Autoriser l\'affichage par-dessus',
          description: 'Paramètres > Applications > Vuel > Autorisations avancées > Afficher par-dessus.',
          imageAsset: 'assets/tutorials/samsung_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Retirer Vuel des apps optimisées',
          description: 'Device Care > Batterie > Limites d\'utilisation en arrière-plan > enlève Vuel.',
          imageAsset: 'assets/tutorials/samsung_battery_1.png',
        ),
      ],
    ),
    'Huawei': BrandTutorial(
      brand: 'Huawei',
      overlaySteps: [
        TutorialStep(
          title: 'Activer la fenêtre flottante',
          description: 'Paramètres > Applications > Vuel > Autres autorisations > Fenêtre flottante.',
          imageAsset: 'assets/tutorials/huawei_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Gestion du lancement',
          description: 'Gestionnaire de téléphone > Lancement des apps > passe Vuel en mode manuel, active tout.',
          imageAsset: 'assets/tutorials/huawei_battery_1.png',
        ),
      ],
    ),
    'Tecno': BrandTutorial(
      brand: 'Tecno',
      overlaySteps: [
        TutorialStep(
          title: 'Ouvrir les autorisations de l\'app',
          description: 'Paramètres > Gestion des applications > Vuel > Autorisations > Afficher au premier plan.',
          imageAsset: 'assets/tutorials/tecno_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Autoriser le démarrage en arrière-plan',
          description: 'Phone Manager > Gestion des applications > Vuel > active "Démarrage automatique" et "Fonctionnement en arrière-plan".',
          imageAsset: 'assets/tutorials/tecno_battery_1.png',
        ),
      ],
    ),
    'Infinix': BrandTutorial(
      brand: 'Infinix',
      overlaySteps: [
        TutorialStep(
          title: 'Ouvrir les autorisations de l\'app',
          description: 'Paramètres > Applications > Vuel > Autorisations > Afficher par-dessus les autres apps.',
          imageAsset: 'assets/tutorials/infinix_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Autoriser le démarrage en arrière-plan',
          description: 'Phone Manager > Gestion des applications > Vuel > active "Démarrage automatique" et "Fonctionnement en arrière-plan".',
          imageAsset: 'assets/tutorials/infinix_battery_1.png',
        ),
      ],
    ),
    'Oppo': BrandTutorial(
      brand: 'Oppo',
      overlaySteps: [
        TutorialStep(
          title: 'Activer la fenêtre flottante',
          description: 'Paramètres > Gestion des applications > Vuel > Autorisations > Afficher sur d\'autres apps.',
          imageAsset: 'assets/tutorials/oppo_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Autoriser le démarrage automatique',
          description: 'Centre de sécurité > Confidentialité > Gestion du démarrage > active Vuel.',
          imageAsset: 'assets/tutorials/oppo_battery_1.png',
        ),
      ],
    ),
    'Realme': BrandTutorial(
      brand: 'Realme',
      overlaySteps: [
        TutorialStep(
          title: 'Activer la fenêtre flottante',
          description: 'Paramètres > Gestion des applications > Vuel > Autorisations > Afficher sur d\'autres apps.',
          imageAsset: 'assets/tutorials/realme_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Autoriser le démarrage automatique',
          description: 'Centre de sécurité > Confidentialité > Gestion du démarrage > active Vuel.',
          imageAsset: 'assets/tutorials/realme_battery_1.png',
        ),
      ],
    ),
    'Vivo': BrandTutorial(
      brand: 'Vivo',
      overlaySteps: [
        TutorialStep(
          title: 'Activer la fenêtre flottante',
          description: 'Paramètres > Applications > Autorisations d\'application > Vuel > Afficher au premier plan.',
          imageAsset: 'assets/tutorials/vivo_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Autoriser le démarrage en arrière-plan',
          description: 'i Manager > Gestion des applications > Autoriser le démarrage automatique > active Vuel.',
          imageAsset: 'assets/tutorials/vivo_battery_1.png',
        ),
      ],
    ),
    'Honor': BrandTutorial(
      brand: 'Honor',
      overlaySteps: [
        TutorialStep(
          title: 'Activer la fenêtre flottante',
          description: 'Paramètres > Applications > Vuel > Autres autorisations > Fenêtre flottante.',
          imageAsset: 'assets/tutorials/honor_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Gestion du lancement',
          description: 'Gestionnaire de téléphone > Lancement des apps > passe Vuel en mode manuel, active tout.',
          imageAsset: 'assets/tutorials/honor_battery_1.png',
        ),
      ],
    ),
    'Itel': BrandTutorial(
      brand: 'Itel',
      overlaySteps: [
        TutorialStep(
          title: 'Ouvrir les autorisations de l\'app',
          description: 'Paramètres > Gestion des applications > Vuel > Autorisations > Afficher au premier plan.',
          imageAsset: 'assets/tutorials/itel_overlay_1.png',
        ),
      ],
      batterySteps: [
        TutorialStep(
          title: 'Autoriser le démarrage en arrière-plan',
          description: 'Phone Manager > Gestion des applications > Vuel > active "Démarrage automatique" et "Fonctionnement en arrière-plan".',
          imageAsset: 'assets/tutorials/itel_battery_1.png',
        ),
      ],
    ),
  };

  /// Repli générique si la marque n'a pas de tutoriel dédié.
  static const BrandTutorial fallback = BrandTutorial(
    brand: 'Autre',
    overlaySteps: [
      TutorialStep(
        title: 'Autoriser l\'affichage par-dessus',
        description: 'Va dans les paramètres de ton téléphone > Applications > Vuel, et active "Affichage par-dessus les autres applications".',
        imageAsset: 'assets/tutorials/generic_overlay_1.png',
      ),
    ],
    batterySteps: [
      TutorialStep(
        title: 'Désactiver l\'optimisation batterie',
        description: 'Paramètres > Batterie > Optimisation de la batterie > sélectionne Vuel > "Ne pas optimiser".',
        imageAsset: 'assets/tutorials/generic_battery_1.png',
      ),
    ],
  );

  static BrandTutorial forBrand(String brand) => tutorials[brand] ?? fallback;
}
