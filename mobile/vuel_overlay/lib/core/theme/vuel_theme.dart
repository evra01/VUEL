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
  );
}
