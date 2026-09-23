import 'package:flutter/material.dart';
import '../../core/api/auth_api_client.dart';
import '../../core/api/user_api_client.dart';
import '../../core/api/wallet_api_client.dart';
import '../../core/api/duels_api_client.dart';
import '../../core/api/tournaments_api_client.dart';
import '../../core/api/banners_api_client.dart';
import '../../core/api/push_api_client.dart';
import '../../core/push/push_service.dart';
import '../../core/state/session.dart';
import '../../core/theme/vuel_theme.dart';
import '../../core/widgets/vuel_floating_nav_bar.dart';
import '../../core/assets/game_logos.dart';
import 'tabs/accueil_tab.dart';
import 'tabs/play_tab.dart';
import 'tabs/wallet_tab.dart';
import 'tabs/profile_tab.dart';

/// Coquille principale une fois connecté — barre de nav du bas identique à la
/// PWA (Accueil / Jouer / Portefeuille / Profil), cf. pwa/index.html .bottomnav.
class HomeShell extends StatefulWidget {
  final Session session;
  final VoidCallback onLoggedOut;

  const HomeShell({super.key, required this.session, required this.onLoggedOut});

  @override
  State<HomeShell> createState() => _HomeShellState();
}

class _HomeShellState extends State<HomeShell> {
  int _index = 0;

  late final UserApiClient _userClient;
  late final WalletApiClient _walletClient;
  late final DuelsApiClient _duelsClient;
  late final TournamentsApiClient _tournamentsClient;
  late final BannersApiClient _bannersClient;
  late final AuthApiClient _authClient;
  late final PushApiClient _pushClient;

  @override
  void initState() {
    super.initState();
    final baseUrl = widget.session.apiBaseUrl;
    final getToken = widget.session.getAccessTokenOrEmpty;
    _authClient = AuthApiClient(baseUrl: baseUrl);
    // Rafraîchit silencieusement l'accessToken (15 min) via le refreshToken
    // (30j) dès qu'un appel API renvoie 401 — voir Session.refreshAccessToken.
    // Si le refreshToken est lui-même expiré/invalide, la session est vidée
    // et on repasse à l'écran de connexion, plutôt que de laisser l'app
    // bloquée sur des appels qui échouent en silence.
    Future<bool> onUnauthorized() async {
      final ok = await widget.session.refreshAccessToken(_authClient);
      if (!ok && mounted) widget.onLoggedOut();
      return ok;
    }

    _userClient = UserApiClient(baseUrl: baseUrl, getAccessToken: getToken, onUnauthorized: onUnauthorized);
    _walletClient = WalletApiClient(baseUrl: baseUrl, getAccessToken: getToken, onUnauthorized: onUnauthorized);
    _duelsClient = DuelsApiClient(baseUrl: baseUrl, getAccessToken: getToken, onUnauthorized: onUnauthorized);
    _tournamentsClient =
        TournamentsApiClient(baseUrl: baseUrl, getAccessToken: getToken, onUnauthorized: onUnauthorized);
    _bannersClient = BannersApiClient(baseUrl: baseUrl, getAccessToken: getToken, onUnauthorized: onUnauthorized);
    _pushClient = PushApiClient(baseUrl: baseUrl, getAccessToken: getToken, onUnauthorized: onUnauthorized);
    // Fire-and-forget : ne doit jamais retarder l'affichage de l'écran
    // d'accueil (cf. PushService.register, entièrement best-effort en interne).
    PushService.register(_pushClient);
  }

  void _goTo(int index) => setState(() => _index = index);

  @override
  Widget build(BuildContext context) {
    final pages = [
      AccueilTab(
        userClient: _userClient,
        walletClient: _walletClient,
        duelsClient: _duelsClient,
        bannersClient: _bannersClient,
        onSeeDuels: () => _goTo(1),
        onSeeTournaments: () => _goTo(1),
        onLogout: () async {
          await PushService.unregister(_pushClient);
          await widget.session.logout();
          widget.onLoggedOut();
        },
      ),
      PlayTab(
        duelsClient: _duelsClient,
        walletClient: _walletClient,
        tournamentsClient: _tournamentsClient,
        userClient: _userClient,
        baseUrl: widget.session.apiBaseUrl,
        accessToken: widget.session.getAccessTokenOrEmpty(),
        onUnauthorized: () async {
          final ok = await widget.session.refreshAccessToken(_authClient);
          if (!ok) widget.onLoggedOut();
          return ok;
        },
      ),
      WalletTab(walletClient: _walletClient),
      ProfileTab(userClient: _userClient),
    ];

    return Scaffold(
      backgroundColor: VuelColors.bg,
      body: SafeArea(bottom: false, child: pages[_index]),
      bottomNavigationBar: VuelFloatingNavBar(
        currentIndex: _index,
        onTap: _goTo,
        // vuelMark (icône seule) plutôt que vuel_logo.png : ce dernier contient
        // le mot "Vuel" et le slogan, illisibles une fois recadrés dans le
        // petit cercle de la nav bar (cf. VuelFloatingNavBar > ClipOval).
        logoAsset: GameLogos.vuelMark,
        items: const [
          VuelNavItem(icon: Icons.home_rounded, label: 'Accueil'),
          VuelNavItem(icon: Icons.sports_esports_rounded, label: 'Jouer'),
          VuelNavItem(icon: Icons.account_balance_wallet_rounded, label: 'Wallet'),
          VuelNavItem(icon: Icons.person_rounded, label: 'Profil'),
        ],
      ),
    );
  }
}
