/// Chemins des logos (déclarés dans pubspec.yaml sous assets/logos/).
class GameLogos {
  static const vuel = 'assets/logos/vuel_logo.png';
  static const efootball = 'assets/logos/efootball_logo.jpg';
  static const codm = 'assets/logos/codm_logo.jpg';
  static const ludo = 'assets/logos/ludo_logo.jpg';
  static const wave = 'assets/logos/wave_logo.png';

  /// [game] attendu au format back-end : 'EFOOTBALL' | 'CODM' | 'LUDO'.
  static String forGame(String game) {
    switch (game) {
      case 'EFOOTBALL':
        return efootball;
      case 'CODM':
        return codm;
      case 'LUDO':
        return ludo;
      default:
        return vuel;
    }
  }
}
