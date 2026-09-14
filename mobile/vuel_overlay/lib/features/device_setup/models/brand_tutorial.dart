class TutorialStep {
  final String title;
  final String description;
  final String imageAsset; // ex: assets/tutorials/xiaomi_step1.png

  const TutorialStep({required this.title, required this.description, required this.imageAsset});
}

class BrandTutorial {
  final String brand;
  final List<TutorialStep> overlaySteps; // activer la bulle flottante
  final List<TutorialStep> batterySteps; // désactiver l'optimisation batterie

  const BrandTutorial({
    required this.brand,
    required this.overlaySteps,
    required this.batterySteps,
  });
}
