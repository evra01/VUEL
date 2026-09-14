import 'package:flutter/material.dart';
import '../../../core/api/user_api_client.dart';
import '../../../core/api/wallet_api_client.dart';
import '../../../core/api/duels_api_client.dart';
import '../../../core/assets/game_logos.dart';
import '../../../core/theme/vuel_theme.dart';
import '../../../core/widgets/player_avatar.dart';

/// Écran Accueil — inspiré des apps de sport/paris (header salutation +
/// avatar, filtres par jeu en pilules, grosses cartes "duel en vedette" avec
/// badge de statut), adapté aux vrais duels Vuel plutôt qu'à des scores.
class AccueilTab extends StatefulWidget {
  final UserApiClient userClient;
  final WalletApiClient walletClient;
  final DuelsApiClient duelsClient;
  final VoidCallback onSeeDuels;
  final VoidCallback onSeeTournaments;
  final Future<void> Function() onLogout;

  const AccueilTab({
    super.key,
    required this.userClient,
    required this.walletClient,
    required this.duelsClient,
    required this.onSeeDuels,
    required this.onSeeTournaments,
    required this.onLogout,
  });

  @override
  State<AccueilTab> createState() => _AccueilTabState();
}

class _AccueilTabState extends State<AccueilTab> {
  static const _games = ['TOUS', 'EFOOTBALL', 'CODM', 'LUDO'];
  static const _gameLabels = {'TOUS': 'Tous', 'EFOOTBALL': 'eFootball', 'CODM': 'COD Mobile', 'LUDO': 'Ludo'};

  Map<String, dynamic>? _profile;
  Map<String, dynamic>? _wallet;
  List<dynamic> _duels = [];
  String _filter = 'TOUS';
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final profile = await widget.userClient.getProfile();
      final wallet = await widget.walletClient.getWallet();
      final duels = await widget.duelsClient.list();
      setState(() {
        _profile = profile;
        _wallet = wallet;
        _duels = duels;
      });
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  List<dynamic> get _filteredDuels {
    if (_filter == 'TOUS') return _duels;
    return _duels.where((d) => d['game'] == _filter).toList();
  }

  @override
  Widget build(BuildContext context) {
    final featured = _filteredDuels.isNotEmpty ? _filteredDuels.first : null;
    final rest = _filteredDuels.length > 1 ? _filteredDuels.sublist(1) : <dynamic>[];

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          _buildHeader(),
          const SizedBox(height: 18),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(_error!, style: const TextStyle(color: VuelColors.red, fontSize: 12)),
            ),
          _buildGameFilters(),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Duels en vedette', style: TextStyle(color: VuelColors.text, fontSize: 15, fontWeight: FontWeight.bold)),
              GestureDetector(
                onTap: widget.onSeeDuels,
                child: const Text('Voir tout', style: TextStyle(color: VuelColors.amber, fontSize: 12, fontWeight: FontWeight.w600)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_loading) const Padding(padding: EdgeInsets.all(30), child: Center(child: CircularProgressIndicator())),
          if (!_loading && featured == null) _buildEmptyState(),
          if (!_loading && featured != null) _FeaturedDuelCard(duel: featured, onTap: widget.onSeeDuels),
          if (rest.isNotEmpty) ...[
            const SizedBox(height: 14),
            ...rest.take(4).map((d) => _CompactDuelCard(duel: d, onTap: widget.onSeeDuels)),
          ],
          const SizedBox(height: 20),
          TextButton(
            onPressed: widget.onSeeTournaments,
            child: const Text('🏆 Voir les tournois en cours', style: TextStyle(color: VuelColors.muted)),
          ),
          TextButton(
            onPressed: widget.onLogout,
            child: const Text('Se déconnecter', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
          ),
        ],
      ),
    );
  }

  Widget _buildHeader() {
    final hour = DateTime.now().hour;
    final greeting = hour < 12 ? 'Bonjour' : (hour < 18 ? 'Bon après-midi' : 'Bonsoir');
    return Row(
      children: [
        PlayerAvatar(pseudo: _profile?['pseudo'], avatarId: _profile?['avatarId'] as String?, radius: 24),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('$greeting 👋', style: const TextStyle(color: VuelColors.muted, fontSize: 12)),
              Text(
                _profile?['pseudo'] ?? '—',
                style: const TextStyle(color: VuelColors.text, fontSize: 19, fontWeight: FontWeight.bold),
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
          decoration: BoxDecoration(color: VuelColors.surface, borderRadius: BorderRadius.circular(16)),
          child: Row(
            children: [
              const Text('💰', style: TextStyle(fontSize: 14)),
              const SizedBox(width: 6),
              Text(
                '${_wallet?['balanceAvailable'] ?? '—'}',
                style: const TextStyle(color: VuelColors.amber, fontWeight: FontWeight.bold, fontSize: 13),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildGameFilters() {
    return SizedBox(
      height: 38,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: _games.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, i) {
          final game = _games[i];
          final active = game == _filter;
          return GestureDetector(
            onTap: () => setState(() => _filter = game),
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: active ? VuelColors.amber : VuelColors.surface,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Text(
                _gameLabels[game] ?? game,
                style: TextStyle(
                  color: active ? const Color(0xFF412402) : VuelColors.muted,
                  fontWeight: active ? FontWeight.w700 : FontWeight.normal,
                  fontSize: 12,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildEmptyState() {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 36),
      decoration: BoxDecoration(color: VuelColors.surface, borderRadius: BorderRadius.circular(18)),
      alignment: Alignment.center,
      child: Column(
        children: [
          const Text('🎮', style: TextStyle(fontSize: 32)),
          const SizedBox(height: 8),
          const Text('Aucun duel pour ce jeu', style: TextStyle(color: VuelColors.muted, fontSize: 13)),
          const SizedBox(height: 10),
          TextButton(onPressed: widget.onSeeDuels, child: const Text('Créer un duel', style: TextStyle(color: VuelColors.amber))),
        ],
      ),
    );
  }
}

class _FeaturedDuelCard extends StatelessWidget {
  final Map<String, dynamic> duel;
  final VoidCallback onTap;
  const _FeaturedDuelCard({required this.duel, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final status = duel['status'] as String? ?? 'OPEN';
    final (statusLabel, statusColor) = switch (status) {
      'OPEN' => ('Ouvert', VuelColors.blue),
      'IN_PROGRESS' => ('En cours', VuelColors.amber),
      'AWAITING_PROOF' => ('En attente de preuve', VuelColors.amber),
      'DISPUTED' => ('Litige', VuelColors.red),
      'COMPLETED' => ('Terminé', VuelColors.green),
      _ => (status, VuelColors.muted),
    };

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [VuelColors.amberDim, VuelColors.surface],
          ),
          borderRadius: BorderRadius.circular(22),
          border: Border.all(color: VuelColors.amber.withValues(alpha: 0.3)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '${duel['game']} · ${duel['mode']}',
                  style: const TextStyle(color: VuelColors.muted, fontSize: 11, fontWeight: FontWeight.w600),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(color: statusColor.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(20)),
                  child: Text(statusLabel, style: TextStyle(color: statusColor, fontSize: 10, fontWeight: FontWeight.w700)),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: _PlayerColumn(label: 'Joueur A')),
                Column(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(10),
                      child: Image.asset(GameLogos.forGame(duel['game'] as String? ?? ''), width: 44, height: 44),
                    ),
                    const SizedBox(height: 6),
                    Text('${duel['stakeAmount']} F', style: const TextStyle(color: VuelColors.amber, fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Expanded(child: _PlayerColumn(label: duel['playerBId'] != null ? 'Joueur B' : 'En attente…', alignEnd: true)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PlayerColumn extends StatelessWidget {
  final String label;
  final bool alignEnd;
  const _PlayerColumn({required this.label, this.alignEnd = false});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: alignEnd ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      children: [
        CircleAvatar(radius: 16, backgroundColor: VuelColors.surface2, child: const Icon(Icons.person, color: VuelColors.muted, size: 16)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: VuelColors.muted, fontSize: 11)),
      ],
    );
  }
}

class _CompactDuelCard extends StatelessWidget {
  final Map<String, dynamic> duel;
  final VoidCallback onTap;
  const _CompactDuelCard({required this.duel, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: VuelColors.surface, borderRadius: BorderRadius.circular(16)),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(20),
              child: Image.asset(GameLogos.forGame(duel['game'] as String? ?? ''), width: 36, height: 36),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${duel['game']} · ${duel['mode']}', style: const TextStyle(color: VuelColors.text, fontSize: 13, fontWeight: FontWeight.w600)),
                  Text(
                    duel['playerBId'] != null ? 'En cours' : 'En attente d\'un adversaire',
                    style: const TextStyle(color: VuelColors.muted, fontSize: 11),
                  ),
                ],
              ),
            ),
            Text('${duel['stakeAmount']} F', style: const TextStyle(color: VuelColors.amber, fontWeight: FontWeight.bold, fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
