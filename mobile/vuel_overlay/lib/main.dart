import 'package:flutter/material.dart';
import 'core/state/session.dart';
import 'core/theme/vuel_theme.dart';
import 'features/auth/auth_screen.dart';
import 'features/home/home_shell.dart';

void main() {
  runApp(const VuelApp());
}

class VuelApp extends StatefulWidget {
  const VuelApp({super.key});

  @override
  State<VuelApp> createState() => _VuelAppState();
}

class _VuelAppState extends State<VuelApp> {
  final Session _session = Session();

  @override
  void initState() {
    super.initState();
    _session.load().then((_) => setState(() {}));
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Vuel',
      debugShowCheckedModeBanner: false,
      theme: buildVuelTheme(),
      home: !_session.loaded
          ? const Scaffold(body: Center(child: CircularProgressIndicator()))
          : _session.isLoggedIn
              ? HomeShell(session: _session, onLoggedOut: () => setState(() {}))
              : AuthScreen(session: _session, onAuthenticated: () => setState(() {})),
    );
  }
}
