import 'package:flutter/material.dart';
import '../../core/api/user_api_client.dart';
import '../../core/assets/app_avatar_icons.dart';
import '../../core/widgets/player_avatar.dart';

/// Grille des icônes fournies par l'app — le joueur en choisit une, aucune
/// photo n'est demandée. cf. décision produit : icônes d'app plutôt que photo.
class AvatarPickerScreen extends StatefulWidget {
  final UserApiClient apiClient;
  final String currentPseudo;
  final String? currentAvatarId;

  const AvatarPickerScreen({
    super.key,
    required this.apiClient,
    required this.currentPseudo,
    this.currentAvatarId,
  });

  @override
  State<AvatarPickerScreen> createState() => _AvatarPickerScreenState();
}

class _AvatarPickerScreenState extends State<AvatarPickerScreen> {
  String? _selected;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _selected = widget.currentAvatarId;
  }

  Future<void> _confirm() async {
    if (_selected == null) return;
    setState(() => _saving = true);
    try {
      await widget.apiClient.setAvatar(_selected!);
      if (mounted) Navigator.of(context).pop(_selected);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Échec de l\'enregistrement — réessaie.')),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ids = AppAvatarIcons.all.keys.toList();

    return Scaffold(
      appBar: AppBar(title: const Text('Choisis ton icône')),
      body: Column(
        children: [
          const SizedBox(height: 16),
          PlayerAvatar(pseudo: widget.currentPseudo, avatarId: _selected, radius: 36),
          const SizedBox(height: 8),
          Text(widget.currentPseudo, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          Expanded(
            child: GridView.count(
              crossAxisCount: 4,
              padding: const EdgeInsets.all(16),
              mainAxisSpacing: 12,
              crossAxisSpacing: 12,
              children: ids.map((id) {
                final isSelected = id == _selected;
                final (icon, color) = AppAvatarIcons.all[id]!;
                return GestureDetector(
                  onTap: () => setState(() => _selected = id),
                  child: Container(
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: color.withOpacity(isSelected ? 0.3 : 0.12),
                      border: isSelected ? Border.all(color: color, width: 2) : null,
                    ),
                    child: Icon(icon, color: color, size: 28),
                  ),
                );
              }).toList(),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: FilledButton(
              onPressed: _selected == null || _saving ? null : _confirm,
              child: _saving
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Text('Valider'),
            ),
          ),
        ],
      ),
    );
  }
}
