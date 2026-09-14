import 'package:flutter/material.dart';
import '../../../core/api/wallet_api_client.dart';
import '../../../core/assets/game_logos.dart';
import '../../../core/theme/vuel_theme.dart';

/// Reprend l'écran "PORTEFEUILLE" de la PWA — solde dispo/verrouillé,
/// historique des transactions, dépôt Wave.
class WalletTab extends StatefulWidget {
  final WalletApiClient walletClient;
  const WalletTab({super.key, required this.walletClient});

  @override
  State<WalletTab> createState() => _WalletTabState();
}

class _WalletTabState extends State<WalletTab> {
  static const _labels = {
    'DEPOSIT': 'Dépôt',
    'WITHDRAW': 'Retrait',
    'ESCROW_LOCK': 'Mise engagée',
    'ESCROW_RELEASE': 'Gain de duel',
    'COMMISSION': 'Commission',
    'TOURNAMENT_ENTRY': 'Inscription tournoi',
    'TOURNAMENT_PAYOUT': 'Gain de tournoi',
    'REFUND': 'Remboursement',
  };
  static const _positive = {'DEPOSIT', 'ESCROW_RELEASE', 'TOURNAMENT_PAYOUT', 'REFUND'};

  Map<String, dynamic>? _wallet;
  List<dynamic> _transactions = [];
  bool _loading = true;
  bool _depositing = false;
  bool _withdrawing = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final wallet = await widget.walletClient.getWallet();
      final txs = await widget.walletClient.getTransactions();
      setState(() {
        _wallet = wallet;
        _transactions = txs;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// Demande le numéro Wave du joueur (même principe qu'Espace Parent) avant
  /// d'ouvrir le lien de paiement : un numéro faux/incomplet empêchera l'admin
  /// de retrouver le paiement reçu et retardera la validation du dépôt.
  Future<void> _deposit(int amount) async {
    final phoneNumber = await _promptWavePhoneNumber(amount);
    if (phoneNumber == null) return; // annulé

    setState(() => _depositing = true);
    try {
      await widget.walletClient.depositViaWave(amount, phoneNumber);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Demande envoyée — un admin valide ton dépôt dès réception du paiement.'),
        ));
      }
      // Le solde ne se met à jour qu'après validation manuelle du dépôt
      // (Telegram) — on rafraîchit au retour au premier plan, pas ici.
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    } finally {
      if (mounted) setState(() => _depositing = false);
    }
  }

  Future<String?> _promptWavePhoneNumber(int amount) async {
    final controller = TextEditingController();
    String? errorText;

    return showDialog<String>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              backgroundColor: VuelColors.surface,
              title: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Image.asset(GameLogos.wave, width: 24, height: 24, fit: BoxFit.cover),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text('Payer $amount F par Wave', style: const TextStyle(color: VuelColors.text, fontSize: 16)),
                  ),
                ],
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Indique le numéro exact que tu vas utiliser pour payer. Un numéro erroné retardera la validation de ton dépôt.',
                    style: TextStyle(color: VuelColors.muted, fontSize: 12),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: controller,
                    keyboardType: TextInputType.phone,
                    autofocus: true,
                    style: const TextStyle(color: VuelColors.text),
                    decoration: InputDecoration(
                      hintText: '+225 07 00 00 00 00',
                      hintStyle: const TextStyle(color: VuelColors.muted),
                      errorText: errorText,
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Annuler'),
                ),
                ElevatedButton(
                  onPressed: () {
                    final value = controller.text.trim();
                    if (!RegExp(r'^\+?\d{8,15}$').hasMatch(value)) {
                      setDialogState(() => errorText = 'Numéro de téléphone invalide.');
                      return;
                    }
                    Navigator.of(dialogContext).pop(value);
                  },
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      ClipRRect(
                        borderRadius: BorderRadius.circular(4),
                        child: Image.asset(GameLogos.wave, width: 16, height: 16, fit: BoxFit.cover),
                      ),
                      const SizedBox(width: 6),
                      const Text('Continuer vers Wave'),
                    ],
                  ),
                ),
              ],
            );
          },
        );
      },
    );
  }

  /// Ouvre le dialog de retrait (montant), puis envoie la demande. Un seul
  /// moyen de retrait pour l'instant : Wave (cf. WithdrawDto côté back-end).
  /// Le montant est débité immédiatement du solde disponible côté back-end
  /// (cf. WalletService.withdraw) — l'envoi réel de l'argent au joueur est
  /// validé manuellement par un admin ensuite. On rafraîchit donc le wallet
  /// tout de suite après une demande réussie pour refléter le débit,
  /// contrairement au dépôt.
  Future<void> _withdraw() async {
    final amount = await _promptWithdraw();
    if (amount == null) return; // annulé

    setState(() => _withdrawing = true);
    try {
      await widget.walletClient.withdraw(amount, 'wave');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Demande de retrait envoyée — un admin va te l\'envoyer sous peu sur Wave.'),
        ));
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
      }
    } finally {
      if (mounted) setState(() => _withdrawing = false);
    }
  }

  Future<int?> _promptWithdraw() async {
    final controller = TextEditingController(text: '2000');
    String? errorText;

    return showDialog<int>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              backgroundColor: VuelColors.surface,
              title: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(6),
                    child: Image.asset(GameLogos.wave, width: 24, height: 24, fit: BoxFit.cover),
                  ),
                  const SizedBox(width: 8),
                  const Text('Retirer vers Wave', style: TextStyle(color: VuelColors.text, fontSize: 16)),
                ],
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('Montant (FCFA)', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
                  const SizedBox(height: 6),
                  TextField(
                    controller: controller,
                    keyboardType: TextInputType.number,
                    autofocus: true,
                    style: const TextStyle(color: VuelColors.text),
                    decoration: InputDecoration(errorText: errorText),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).pop(),
                  child: const Text('Annuler'),
                ),
                ElevatedButton(
                  onPressed: () {
                    final amount = int.tryParse(controller.text.trim()) ?? 0;
                    if (amount < 500) {
                      setDialogState(() => errorText = 'Montant minimum : 500 F.');
                      return;
                    }
                    Navigator.of(dialogContext).pop(amount);
                  },
                  child: const Text('Confirmer'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Portefeuille', style: TextStyle(color: VuelColors.text, fontSize: 20, fontWeight: FontWeight.bold)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: VuelColors.surface, borderRadius: BorderRadius.circular(14)),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Solde disponible', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
                Text(
                  '${_wallet?['balanceAvailable'] ?? '—'} F',
                  style: const TextStyle(color: VuelColors.text, fontSize: 26, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 8),
                Text('Verrouillé (mises en cours) : ${_wallet?['balanceLocked'] ?? '—'} F',
                    style: const TextStyle(color: VuelColors.muted, fontSize: 12)),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(6),
                child: Image.asset(GameLogos.wave, width: 20, height: 20, fit: BoxFit.cover),
              ),
              const SizedBox(width: 8),
              const Text('Déposer via Wave', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [1000, 2000, 5000].map((amount) {
              return Expanded(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: ElevatedButton(
                    onPressed: _depositing ? null : () => _deposit(amount),
                    child: Text('+$amount F', style: const TextStyle(fontSize: 12)),
                  ),
                ),
              );
            }).toList(),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: _withdrawing ? null : _withdraw,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (!_withdrawing) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: Image.asset(GameLogos.wave, width: 16, height: 16, fit: BoxFit.cover),
                    ),
                    const SizedBox(width: 6),
                  ],
                  Text(_withdrawing ? 'Retrait en cours…' : '↓ Retirer', style: const TextStyle(fontSize: 13)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 20),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text('Transactions', style: TextStyle(color: VuelColors.text, fontSize: 13, fontWeight: FontWeight.w600)),
              GestureDetector(onTap: _load, child: const Text('Actualiser', style: TextStyle(color: VuelColors.amber, fontSize: 12))),
            ],
          ),
          const SizedBox(height: 8),
          if (_loading) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
          if (!_loading && _transactions.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Text('Aucune transaction pour l\'instant.', style: TextStyle(color: VuelColors.muted, fontSize: 12)),
            ),
          ..._transactions.map((tx) {
            final type = tx['type'] as String? ?? '';
            final isPositive = _positive.contains(type);
            final amount = tx['amount'];
            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 8),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 15,
                    backgroundColor: isPositive ? VuelColors.green.withValues(alpha: 0.15) : VuelColors.red.withValues(alpha: 0.15),
                    child: Text(isPositive ? '+' : '−', style: TextStyle(color: isPositive ? VuelColors.green : VuelColors.red, fontSize: 12)),
                  ),
                  const SizedBox(width: 10),
                  Expanded(child: Text(_labels[type] ?? type, style: const TextStyle(color: VuelColors.text, fontSize: 13))),
                  Text(
                    '${isPositive ? '+' : '-'}$amount F',
                    style: TextStyle(color: isPositive ? VuelColors.green : VuelColors.muted, fontSize: 12, fontWeight: FontWeight.w600),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
