import 'package:flutter/material.dart';
import '../../core/api/tournaments_api_client.dart';

const _minStake = 200; // FCFA — mise minimum, cf. décision produit + validation back-end

class TournamentsScreen extends StatefulWidget {
  final TournamentsApiClient apiClient;
  final String currentUserId;

  const TournamentsScreen({super.key, required this.apiClient, required this.currentUserId});

  @override
  State<TournamentsScreen> createState() => _TournamentsScreenState();
}

class _TournamentsScreenState extends State<TournamentsScreen> {
  List<dynamic> _tournaments = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    try {
      final tournaments = await widget.apiClient.list();
      setState(() => _tournaments = tournaments);
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _join(String tournamentId) async {
    try {
      await widget.apiClient.join(tournamentId);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Inscription confirmée !')));
      _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _startIfOrganizer(Map<String, dynamic> tournament) async {
    try {
      await widget.apiClient.start(tournament['id'] as String);
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Tournoi lancé !')));
      _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _cancelIfOrganizer(Map<String, dynamic> tournament) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Annuler le tournoi ?'),
        content: const Text('Tous les participants seront remboursés (mise recréditée sur leur wallet).'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Non')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Oui, annuler')),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await widget.apiClient.cancel(tournament['id'] as String);
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(const SnackBar(content: Text('Tournoi annulé — tout le monde est remboursé.')));
      }
      _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  Future<void> _openCreateDialog() async {
    final nameController = TextEditingController();
    final stakeController = TextEditingController(text: '$_minStake');
    final maxController = TextEditingController(text: '8');
    String game = 'EFOOTBALL';

    final created = await showDialog<bool>(
      context: context,
      builder: (context) => StatefulBuilder(
        builder: (context, setDialogState) => AlertDialog(
          title: const Text('Organiser un tournoi'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(controller: nameController, decoration: const InputDecoration(labelText: 'Nom du tournoi')),
              DropdownButton<String>(
                value: game,
                items: const [
                  DropdownMenuItem(value: 'EFOOTBALL', child: Text('eFootball')),
                  DropdownMenuItem(value: 'CODM', child: Text('CODM')),
                  DropdownMenuItem(value: 'LUDO', child: Text('Ludo')),
                ],
                onChanged: (v) => setDialogState(() => game = v!),
              ),
              TextField(
                controller: stakeController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Mise par joueur (min. $_minStake F)'),
              ),
              TextField(
                controller: maxController,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Nombre max de participants'),
              ),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Annuler')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Créer')),
          ],
        ),
      ),
    );

    if (created != true) return;

    final stake = int.tryParse(stakeController.text) ?? _minStake;
    if (stake < _minStake) {
      if (mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text('La mise minimum est de $_minStake F')));
      }
      return;
    }

    try {
      await widget.apiClient.create(
        name: nameController.text.trim().isEmpty ? 'Tournoi Vuel' : nameController.text.trim(),
        game: game,
        stakeAmount: stake,
        maxParticipants: int.tryParse(maxController.text) ?? 8,
      );
      _refresh();
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tournois'),
        actions: [IconButton(icon: const Icon(Icons.refresh), onPressed: _refresh)],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openCreateDialog,
        icon: const Icon(Icons.add),
        label: const Text('Organiser'),
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _tournaments.isEmpty
              ? const Center(child: Text('Aucun tournoi ouvert pour l\'instant.'))
              : ListView.builder(
                  padding: const EdgeInsets.all(16),
                  itemCount: _tournaments.length,
                  itemBuilder: (context, i) {
                    final t = _tournaments[i] as Map<String, dynamic>;
                    final participantCount = (t['_count'] as Map<String, dynamic>?)?['participants'] ?? 0;
                    final isOrganizer = t['organizerId'] == widget.currentUserId;
                    final isOpen = t['status'] == 'OPEN';
                    final isCancellable = t['status'] == 'OPEN' || t['status'] == 'IN_PROGRESS';

                    return Card(
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(t['name'] as String, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                            const SizedBox(height: 4),
                            Text('${t['game']} · Mise ${t['stakeAmount']} F · $participantCount/${t['maxParticipants']} joueurs'),
                            Text('Prize pool actuel : ${t['prizePool']} F', style: const TextStyle(color: Colors.grey)),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                if (isOpen)
                                  FilledButton(
                                    onPressed: () => _join(t['id'] as String),
                                    child: const Text('Rejoindre'),
                                  ),
                                if (isOpen && isOrganizer) ...[
                                  const SizedBox(width: 8),
                                  OutlinedButton(
                                    onPressed: () => _startIfOrganizer(t),
                                    child: const Text('Démarrer'),
                                  ),
                                ],
                                if (isCancellable && isOrganizer) ...[
                                  const SizedBox(width: 8),
                                  TextButton(
                                    onPressed: () => _cancelIfOrganizer(t),
                                    style: TextButton.styleFrom(foregroundColor: Colors.red),
                                    child: const Text('Annuler'),
                                  ),
                                ],
                                if (!isOpen)
                                  Chip(label: Text(t['status'] as String)),
                              ],
                            ),
                          ],
                        ),
                      ),
                    );
                  },
                ),
    );
  }
}
