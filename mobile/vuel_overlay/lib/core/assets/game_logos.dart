/// Chemins des logos (déclarés dans pubspec.yaml sous assets/logos/).
class GameLogos {
  static const vuel = 'assets/logos/vuel_logo.png';
  /// Version "icône seule" (le V couronné, sans le mot "Vuel" ni le
  /// slogan) — même fichier que pwa/icons/vuel_mark.png. À utiliser partout
  /// où le logo est affiché petit ou dans un cercle/carré (nav bar, écran de
  /// connexion, icône de l'app) : vuel_logo.png contient du texte qui devient
  /// illisible une fois recadré/réduit.
  static const vuelMark = 'assets/logos/vuel_mark.png';
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
