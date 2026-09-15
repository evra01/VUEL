import 'package:flutter/material.dart';
import '../../../core/api/user_api_client.dart';
import '../../../core/theme/vuel_theme.dart';
import '../../../core/widgets/vuel_feedback.dart';
import '../../../core/widgets/player_avatar.dart';
import '../../avatar_picker/avatar_picker_screen.dart';
import '../../device_setup/device_setup_screen.dart';

/// Reprend l'écran "PROFIL" de la PWA — pseudo, réputation, IDs de jeu,
/// icône d'avatar, et accès à la configuration de l'appareil (overlay/batterie).
class ProfileTab extends StatefulWidget {
  final UserApiClient userClient;
  const ProfileTab({super.key, required this.userClient});

  @override
  State<ProfileTab> createState() => _ProfileTabState();
}

class _ProfileTabState extends State<ProfileTab> {
  static const _gameIcons = {'EFOOTBALL': '⚽', 'CODM': '🎯', 'LUDO': '🎲'};
  static const _games = ['EFOOTBALL', 'CODM', 'LUDO'];

  Map<String, dynamic>? _profile;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final profile = await widget.userClient.getProfile();
      setState(() => _profile = profile);
    } catch (e) {
      if (mounted) {
        VuelFeedback.error(context, e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _openAvatarPicker() async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => AvatarPickerScreen(
          apiClient: widget.userClient,
          currentPseudo: _profile?['pseudo'] ?? '',
          currentAvatarId: _profile?['avatarId'] as String?,
        ),
      ),
    );
    _load();
  }

  void _openDeviceSetup() {
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => DeviceSetupScreen(apiClient: widget.userClient)),
    );
  }

  Future<void> _addGamingId(String game) async {
    final pseudoController = TextEditingController();
    final teamController = TextEditingController();
    final isEfootball = game == 'EFOOTBALL';

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: VuelColors.surface,
        title: Text('Pseudo ${_gameIcons[game]}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(controller: pseudoController, autofocus: true, decoration: const InputDecoration()),
            if (isEfootball) ...[
              const SizedBox(height: 12),
              const Text('Équipe de rêve', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
              const SizedBox(height: 4),
              TextField(
                controller: teamController,
                decoration: const InputDecoration(hintText: 'ex: Manchester United'),
              ),
              const SizedBox(height: 4),
              const Text(
                'Sert à identifier automatiquement le gagnant sur tes captures de fin de match.',
                style: TextStyle(color: VuelColors.muted, fontSize: 11),
              ),
            ],
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Annuler')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Enregistrer')),
        ],
      ),
    );
    if (confirmed != true || pseudoController.text.trim().isEmpty) return;
    try {
      await widget.userClient.addGamingId(
        game: game,
        gamePseudo: pseudoController.text.trim(),
        favoriteTeam: isEfootball ? teamController.text.trim() : null,
      );
      _load();
    } catch (e) {
      if (mounted) {
        VuelFeedback.error(context, e.toString().replaceFirst('Exception: ', ''));
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) return const Center(child: CircularProgressIndicator());

    final gamingIds = (_profile?['gamingIds'] as List<dynamic>? ?? []);

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: Column(
              children: [
                GestureDetector(
                  onTap: _openAvatarPicker,
                  child: PlayerAvatar(pseudo: _profile?['pseudo'], avatarId: _profile?['avatarId'] as String?, radius: 34),
                ),
                const SizedBox(height: 10),
                Text(_profile?['pseudo'] ?? '—', style: const TextStyle(color: VuelColors.text, fontSize: 18, fontWeight: FontWeight.bold)),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Text('⭐ ', style: TextStyle(fontSize: 12)),
                    Text('${_profile?['reputationScore'] ?? '—'}', style: const TextStyle(color: VuelColors.muted, fontSize: 12)),
                    const SizedBox(width: 10),
                    Text(
                      _profile?['kycStatus'] == 'VERIFIED' ? '✅ Vérifié' : '— Non vérifié',
                      style: const TextStyle(color: VuelColors.muted, fontSize: 12),
                    ),
                  ],
                ),
                TextButton(onPressed: _openAvatarPicker, child: const Text('Changer d\'icône', style: TextStyle(color: VuelColors.amber, fontSize: 12))),
              ],
            ),
          ),
          const SizedBox(height: 16),
          const Text('Mes IDs de jeu', style: TextStyle(color: VuelColors.text, fontSize: 13, fontWeight: FontWeight.w600)),
          const SizedBox(height: 8),
          ..._games.map((game) {
            final entry = gamingIds.firstWhere((g) => g['game'] == game, orElse: () => null);
            return Container(
              margin: const EdgeInsets.only(bottom: 8),
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(color: VuelColors.surface, borderRadius: BorderRadius.circular(12)),
              child: Row(
                children: [
                  Text(_gameIcons[game] ?? '🎮', style: const TextStyle(fontSize: 16)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          entry != null ? entry['gamePseudo'] as String : 'Non renseigné',
                          style: TextStyle(color: entry != null ? VuelColors.text : VuelColors.muted, fontSize: 13),
                        ),
                        if (entry != null && (entry['favoriteTeam'] as String?)?.isNotEmpty == true)
                          Text('Équipe : ${entry['favoriteTeam']}', style: const TextStyle(color: VuelColors.muted, fontSize: 11)),
                      ],
                    ),
                  ),
                  TextButton(
                    onPressed: () => _addGamingId(game),
                    child: Text(entry != null ? 'Modifier' : 'Ajouter', style: const TextStyle(color: VuelColors.amber, fontSize: 12)),
                  ),
                ],
              ),
            );
          }),
          const SizedBox(height: 10),
          OutlinedButton(
            onPressed: _openDeviceSetup,
            child: const Text('📱 Configuration de l\'appareil (overlay, batterie)'),
          ),
        ],
      ),
    );
  }
}
