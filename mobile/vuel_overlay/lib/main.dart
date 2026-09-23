import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'core/state/session.dart';
import 'core/theme/vuel_theme.dart';
import 'core/push/push_service.dart';
import 'features/auth/auth_screen.dart';
import 'features/home/home_shell.dart';

Future<void> main() async {
  // Nécessaire dès qu'on appelle du code Flutter (Firebase.initializeApp) avant
  // runApp() — sinon exception "binding has not yet been initialized".
  WidgetsFlutterBinding.ensureInitialized();

  // Best-effort, comme tout le reste de la fonctionnalité push (cf.
  // PushService, PushDeliveryService côté back-end) : si Firebase échoue à
  // s'initialiser (plugin Gradle pas encore branché, google-services.json
  // absent/mal repris, pas de réseau au lancement...), l'app doit démarrer
  // normalement quand même — juste sans notifications push. Sans ce
  // try/catch, une erreur ici bloquait tout AVANT le premier runApp(),
  // laissant l'app coincée sur l'écran de lancement natif indéfiniment.
  try {
    await Firebase.initializeApp();
    // DOIT être enregistré ici, au tout début de main() — Firebase Messaging
    // s'y attend pour pouvoir relancer ce handler dans un isolate séparé quand
    // un message arrive app tuée (cf. commentaire détaillé dans push_service.dart).
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (e) {
    debugPrint('Firebase indisponible au démarrage — notifications push désactivées pour cette session : $e');
  }

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
