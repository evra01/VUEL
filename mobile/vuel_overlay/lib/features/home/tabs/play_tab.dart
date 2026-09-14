import 'package:flutter/material.dart';
import '../../../core/api/duels_api_client.dart';
import '../../../core/api/wallet_api_client.dart';
import '../../../core/api/tournaments_api_client.dart';
import '../../../core/api/user_api_client.dart';
import '../../../core/assets/game_logos.dart';
import '../../../core/theme/vuel_theme.dart';
import '../../../core/share/duel_share.dart';
import '../../duel_room/duel_room_screen.dart';
import '../../tournaments/tournaments_screen.dart';

/// Reprend l'écran "JOUER" de la PWA — choix du jeu + de la mise, création
/// d'un duel, et liste des duels ouverts à rejoindre.
class PlayTab extends StatefulWidget {
  final DuelsApiClient duelsClient;
  final WalletApiClient walletClient;
  final TournamentsApiClient tournamentsClient;
  final UserApiClient userClient;
  final String baseUrl;
  final String accessToken;
  /// Voir DuelsApiClient.onUnauthorized — transmis jusqu'à DuelRoomScreen
  /// pour que le rafraîchissement silencieux du token fonctionne aussi une
  /// fois dans le salon (ex: écran resté ouvert plus de 15 min).
  final Future<bool> Function()? onUnauthorized;

  const PlayTab({
    super.key,
    required this.duelsClient,
    required this.walletClient,
    required this.tournamentsClient,
    required this.userClient,
    required this.baseUrl,
    required this.accessToken,
    this.onUnauthorized,
  });

  @override
  State<PlayTab> createState() => _PlayTabState();
}

class _PlayTabState extends State<PlayTab> {
  static const _games = ['EFOOTBALL', 'CODM', 'LUDO'];
  // Paliers rapides, plus une option "Personnalisé" en dessous qui ouvre un
  // champ libre — la mise minimum reste 200 F (cf. CreateDuelDto côté back-end).
  static const _minStake = 200;
  static const _stakes = [500, 1000, 2000];

  String _selectedGame = 'EFOOTBALL';
  int? _selectedStake = 1000;
  bool _customStakeSelected = false;
  final _customStakeController = TextEditingController();
  final _teamController = TextEditingController();
  int? _balance;
  List<dynamic> _duels = [];
  bool _loading = true;
  bool _creating = false;
  String? _currentUserId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _customStakeController.dispose();
    _teamController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final wallet = await widget.walletClient.getWallet();
      final duels = await widget.duelsClient.list();
      final profile = await widget.userClient.getProfile();
      setState(() {
        _balance = wallet['balanceAvailable'] as int?;
        _duels = duels;
        _currentUserId = profile['id'] as String?;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _createDuel() async {
    // Le nom d'équipe n'existe que sur l'écran de fin de match eFootball
    // (cf. TEAM_SCORE_PATTERN côté OCR) — inutile et non stocké pour
    // CODM/LUDO (cf. CreateDuelDto côté back-end), donc on ne le
    // demande/valide que dans ce cas.
    final bool isEfootball = _selectedGame == 'EFOOTBALL';
    final team = _teamController.text.trim();
    if (isEfootball && team.length < 2) {
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Indique le nom de ton équipe (2 caractères minimum)')));
      return;
    }

    final int? stake = _customStakeSelected ? int.tryParse(_customStakeController.text.trim()) : _selectedStake;
    if (stake == null || stake < _minStake) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text('La mise minimum est de $_minStake F')));
      return;
    }

    setState(() => _creating = true);
    try {
      final created = await widget.duelsClient.create(
        game: _selectedGame,
        mode: '1v1',
        stakeAmount: stake,
        playerATeam: isEfootball ? team : null,
      );
      if (mounted) {
        final createdId = created['id'] as String?;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: const Text('Duel créé — en attente d\'un adversaire'),
          action: createdId != null
              ? SnackBarAction(
                  label: 'Inviter un ami',
                  onPressed: () => shareDuelInvite(
                    context: context,
                    baseUrl: widget.baseUrl,
                    duelId: createdId,
                    game: _selectedGame,
                    stakeAmount: stake,
                  ),
                )
              : null,
          duration: const Duration(seconds: 6),
        ));
      }
      _teamController.clear();
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    } finally {
      if (mounted) setState(() => _creating = false);
    }
  }

  void _openDuel(String duelId) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => DuelRoomScreen(
          duelId: duelId,
          baseUrl: widget.baseUrl,
          accessToken: widget.accessToken,
          currentUserId: _currentUserId ?? '',
          onUnauthorized: widget.onUnauthorized,
        ),
      ),
    ).then((_) => _load());
  }

  void _openTournaments() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => TournamentsScreen(
          apiClient: widget.tournamentsClient,
          currentUserId: _currentUserId ?? '',
        ),
      ),
    );
  }

  // Le nom d'équipe est requis pour rejoindre UNIQUEMENT si le duel est
  // EFOOTBALL (cf. JoinDuelDto / DuelsService.join côté back-end — le jeu du
  // duel n'a pas de nom de club pour CODM/LUDO) — demandé ici via une boîte
  // de dialogue plutôt que dans le formulaire principal, puisqu'on ne le
  // connaît qu'au moment de rejoindre un duel précis (pas à la création de
  // l'écran).
  Future<void> _joinDuel(Map<String, dynamic> duel) async {
    final duelId = duel['id'] as String;
    final bool isEfootball = duel['game'] == 'EFOOTBALL';

    String? team;
    if (isEfootball) {
      final controller = TextEditingController();
      team = await showDialog<String>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Ton équipe'),
          content: TextField(
            controller: controller,
            autofocus: true,
            decoration: const InputDecoration(labelText: 'Nom de ton équipe'),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Annuler')),
            ElevatedButton(
              onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
              child: const Text('Rejoindre'),
            ),
          ],
        ),
      );
      controller.dispose();
      if (team == null) return; // annulé
      if (team.length < 2) {
        if (mounted) {
          ScaffoldMessenger.of(context)
              .showSnackBar(const SnackBar(content: Text('Indique le nom de ton équipe (2 caractères minimum)')));
        }
        return;
      }
    }

    try {
      await widget.duelsClient.join(duelId, playerBTeam: team);
      _openDuel(duelId);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    }
  }

  // Point d'entrée pour un ami qui a reçu un lien d'invitation /d/:id (cf.
  // DuelInviteController côté back-end) mais qui n'a pas pu (ou voulu)
  // laisser le deep-link `vuel://` ouvrir l'app directement — il colle
  // simplement l'identifiant du salon affiché sur la page d'invitation.
  Future<void> _joinByCode() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rejoindre avec un code'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            labelText: 'Code du salon',
            hintText: 'Collé depuis le lien d\'invitation reçu',
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Annuler')),
          ElevatedButton(
            onPressed: () => Navigator.pop(dialogContext, controller.text.trim()),
            child: const Text('Continuer'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (code == null || code.isEmpty) return;

    try {
      // On récupère le duel pour connaître son jeu (nécessaire pour savoir si
      // le nom d'équipe est requis avant de rejoindre, cf. _joinDuel) et pour
      // donner un message clair si le code est invalide plutôt qu'une erreur
      // générique de l'API /join.
      final duel = await widget.duelsClient.getDetail(code);
      if (!mounted) return;
      await _joinDuel(duel);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Jouer', style: TextStyle(color: VuelColors.text, fontSize: 20, fontWeight: FontWeight.bold)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(color: VuelColors.surface2, borderRadius: BorderRadius.circular(20)),
                child: Text('💰 ${_balance ?? '—'}', style: const TextStyle(color: VuelColors.amber, fontSize: 12, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              TextButton(onPressed: _openTournaments, child: const Text('🏆 Voir les tournois')),
              const Spacer(),
              TextButton.icon(
                onPressed: _joinByCode,
                icon: const Icon(Icons.key_rounded, size: 16),
                label: const Text('Rejoindre avec un code'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text('Choisis ton jeu', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
          const SizedBox(height: 8),
          Row(
            children: _games.map((game) {
              final active = game == _selectedGame;
              return Expanded(
                child: GestureDetector(
                  onTap: () => setState(() => _selectedGame = game),
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    padding: const EdgeInsets.symmetric(vertical: 8),
                    decoration: BoxDecoration(
                      border: Border.all(color: active ? VuelColors.amber : VuelColors.border),
                      borderRadius: BorderRadius.circular(10),
                      color: active ? VuelColors.amberDim : Colors.transparent,
                    ),
                    child: Column(
                      children: [
                        ClipRRect(
                          borderRadius: BorderRadius.circular(8),
                          child: Image.asset(GameLogos.forGame(game), height: 40),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          game,
                          style: TextStyle(
                            fontSize: 10,
                            color: active ? VuelColors.amber : const Color(0xFFD3D1C7),
                            fontWeight: active ? FontWeight.w600 : FontWeight.normal,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
          // Nom d'équipe : pertinent UNIQUEMENT pour eFootball (seul jeu dont
          // l'écran de fin de match affiche un nom de club, cf. CreateDuelDto
          // côté back-end) — affiché ici juste après le choix du jeu, donc
          // au-dessus du choix de la mise, jamais en dessous.
          if (_selectedGame == 'EFOOTBALL') ...[
            const SizedBox(height: 16),
            const Text('Nom de ton équipe', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
            const SizedBox(height: 6),
            TextField(
              controller: _teamController,
              decoration: const InputDecoration(
                hintText: 'Ex: Real Madrid',
                // Utilisé par le bot pour analyser automatiquement le résultat
                // à partir de la capture d'écran en fin de match.
                helperText: 'Utilisé par le bot pour analyser le résultat de fin de match',
              ),
            ),
          ],
          const SizedBox(height: 16),
          const Text('Choisis ta mise', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
          const SizedBox(height: 6),
          Row(
            children: [
              ..._stakes.map((stake) {
                final active = !_customStakeSelected && stake == _selectedStake;
                return Expanded(
                  child: GestureDetector(
                    onTap: () => setState(() {
                      _selectedStake = stake;
                      _customStakeSelected = false;
                    }),
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 4),
                      padding: const EdgeInsets.symmetric(vertical: 9),
                      decoration: BoxDecoration(
                        color: active ? VuelColors.amberDim : Colors.transparent,
                        border: Border.all(color: active ? VuelColors.amber : const Color(0xFF333333)),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      alignment: Alignment.center,
                      child: Text(
                        '$stake F',
                        style: TextStyle(
                          fontSize: 13,
                          color: active ? VuelColors.amber : const Color(0xFFD3D1C7),
                          fontWeight: active ? FontWeight.w600 : FontWeight.normal,
                        ),
                      ),
                    ),
                  ),
                );
              }),
              Expanded(
                child: GestureDetector(
                  onTap: () => setState(() => _customStakeSelected = true),
                  child: Container(
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    padding: const EdgeInsets.symmetric(vertical: 9),
                    decoration: BoxDecoration(
                      color: _customStakeSelected ? VuelColors.amberDim : Colors.transparent,
                      border: Border.all(color: _customStakeSelected ? VuelColors.amber : const Color(0xFF333333)),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    alignment: Alignment.center,
                    child: Text(
                      'Autre',
                      style: TextStyle(
                        fontSize: 13,
                        color: _customStakeSelected ? VuelColors.amber : const Color(0xFFD3D1C7),
                        fontWeight: _customStakeSelected ? FontWeight.w600 : FontWeight.normal,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
          if (_customStakeSelected) ...[
            const SizedBox(height: 8),
            TextField(
              controller: _customStakeController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: 'Montant personnalisé (min. $_minStake F)',
                suffixText: 'F',
              ),
            ),
          ],
          const SizedBox(height: 16),
          ElevatedButton(
            onPressed: _creating ? null : _createDuel,
            child: _creating
                ? const SizedBox(height: 18, width: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('⚡ Créer un duel'),
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Duels ouverts', style: TextStyle(color: VuelColors.text, fontSize: 13, fontWeight: FontWeight.w600)),
              GestureDetector(
                onTap: _load,
                child: const Text('Actualiser', style: TextStyle(color: VuelColors.amber, fontSize: 12)),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (_loading) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
          if (!_loading && _duels.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Text(
                'Aucun duel ouvert — sois le premier à en créer un !',
                textAlign: TextAlign.center,
                style: TextStyle(color: VuelColors.muted, fontSize: 12),
              ),
            ),
          ..._duels.map((duel) => _DuelCard(
                duel: duel,
                mine: duel['playerAId'] == _currentUserId,
                onTap: () => _openDuel(duel['id'] as String),
                onJoin: () => _joinDuel(duel as Map<String, dynamic>),
                onShare: () => shareDuelInvite(
                  context: context,
                  baseUrl: widget.baseUrl,
                  duelId: duel['id'] as String,
                  game: duel['game'] as String?,
                  stakeAmount: duel['stakeAmount'] as int?,
                ),
              )),
        ],
      ),
    );
  }
}

class _DuelCard extends StatelessWidget {
  final Map<String, dynamic> duel;
  final bool mine;
  final VoidCallback onTap;
  final VoidCallback onJoin;
  final VoidCallback onShare;

  const _DuelCard({required this.duel, required this.mine, required this.onTap, required this.onJoin, required this.onShare});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: VuelColors.surface, borderRadius: BorderRadius.circular(14)),
      child: Row(
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(20),
            child: Image.asset(GameLogos.forGame(duel['game'] as String? ?? ''), width: 32, height: 32),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('${duel['game']} · ${duel['mode']}', style: const TextStyle(color: VuelColors.text, fontSize: 13, fontWeight: FontWeight.w600)),
                Text('${duel['stakeAmount']} F', style: const TextStyle(color: VuelColors.muted, fontSize: 12)),
              ],
            ),
          ),
          // Partager n'a de sens que pour son propre salon (encore OPEN, en
          // attente d'un adversaire) — un salon déjà rejoint n'a plus besoin
          // d'invitation.
          if (mine)
            IconButton(
              onPressed: onShare,
              tooltip: 'Partager le salon',
              icon: const Icon(Icons.share_rounded, color: VuelColors.amber, size: 20),
            ),
          mine
              ? TextButton(onPressed: onTap, child: const Text('Voir', style: TextStyle(color: VuelColors.amber)))
              : ElevatedButton(
                  onPressed: onJoin,
                  style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8)),
                  child: const Text('Rejoindre', style: TextStyle(fontSize: 12)),
                ),
        ],
      ),
    );
  }
}
