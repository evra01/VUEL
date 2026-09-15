import 'package:flutter/material.dart';

/// Palette identique à celle de la PWA (voir pwa/index.html, variables CSS
/// --bg/--amber/etc.) — gardée synchronisée manuellement, pas de source
/// commune entre les deux apps pour l'instant.
class VuelColors {
  static const bg = Color(0xFF0A0A0A);
  static const surface = Color(0xFF141414);
  static const surface2 = Color(0xFF1A1A1A);
  static const amber = Color(0xFFF0A52A);
  static const amberDim = Color(0xFF2A1C08);
  static const text = Color(0xFFF2F2F0);
  static const muted = Color(0xFF888780);
  static const green = Color(0xFF5DCAA5);
  static const red = Color(0xFFE14B3C);
  static const blue = Color(0xFF4B7BE1);
  static const border = Color(0xFF232323);
}

ThemeData buildVuelTheme() {
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    scaffoldBackgroundColor: VuelColors.bg,
    colorScheme: ColorScheme.fromSeed(
      seedColor: VuelColors.amber,
      brightness: Brightness.dark,
      primary: VuelColors.amber,
      surface: VuelColors.surface,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: VuelColors.bg,
      foregroundColor: VuelColors.text,
      elevation: 0,
    ),
    cardTheme: CardThemeData(
      color: VuelColors.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ),
    textTheme: const TextTheme(
      bodyMedium: TextStyle(color: VuelColors.text),
      bodyLarge: TextStyle(color: VuelColors.text),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: VuelColors.surface2,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10),
        borderSide: const BorderSide(color: VuelColors.border, width: 0.5),
      ),
      labelStyle: const TextStyle(color: VuelColors.muted, fontSize: 12),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: VuelColors.amber,
        foregroundColor: const Color(0xFF412402),
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: VuelColors.amber,
        side: const BorderSide(color: VuelColors.amber),
        padding: const EdgeInsets.symmetric(vertical: 14),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: VuelColors.bg,
      selectedItemColor: VuelColors.amber,
      unselectedItemColor: VuelColors.muted,
      type: BottomNavigationBarType.fixed,
    ),
    tabBarTheme: const TabBarThemeData(
      labelColor: VuelColors.amber,
      unselectedLabelColor: VuelColors.muted,
      indicatorColor: VuelColors.amber,
    ),
    // Style global pour TOUTES les boîtes de dialogue de l'app (confirmation,
    // formulaires de mise, etc.) — coins arrondis cohérents avec le reste de
    // l'UI (cardTheme, inputDecorationTheme) plutôt que les coins par défaut
    // de Material, et titre/texte alignés sur la palette Vuel plutôt que sur
    // les couleurs Material par défaut (qui juraient avec le fond sombre).
    dialogTheme: DialogThemeData(
      backgroundColor: VuelColors.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: VuelColors.border, width: 0.5),
      ),
      titleTextStyle: const TextStyle(color: VuelColors.text, fontSize: 18, fontWeight: FontWeight.w600),
      contentTextStyle: const TextStyle(color: VuelColors.muted, fontSize: 14, height: 1.4),
    ),
    // Style global pour TOUS les SnackBar de l'app, y compris ceux construits
    // à la main ailleurs (SnackBar(content: Text(...))) — ils héritent
    // automatiquement de ce style sans qu'il faille toucher chaque appel.
    // behavior: floating + marge + coins arrondis, au lieu du bandeau plein
    // largeur collé en bas par défaut, qui passait inaperçu et jurait avec
    // le reste de l'UI. Les couleurs par type (succès/erreur/avertissement)
    // restent définies au cas par cas via VuelFeedback (voir
    // core/widgets/vuel_feedback.dart), ce thème ne fixe que la base neutre.
    snackBarTheme: SnackBarThemeData(
      backgroundColor: VuelColors.surface2,
      contentTextStyle: const TextStyle(color: VuelColors.text, fontSize: 14),
      behavior: SnackBarBehavior.floating,
      insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: VuelColors.border, width: 0.5),
      ),
      actionTextColor: VuelColors.amber,
      elevation: 4,
    ),
  );
}
