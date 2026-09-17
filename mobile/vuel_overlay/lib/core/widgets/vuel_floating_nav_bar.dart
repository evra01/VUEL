import 'package:flutter/material.dart';
import '../theme/vuel_theme.dart';

class VuelNavItem {
  final IconData icon;
  final String label;
  const VuelNavItem({required this.icon, required this.label});
}

/// Barre de navigation flottante en forme de pilule, avec logo circulaire qui
/// déborde sur la gauche — reprend le style Pinterest (icône + libellé, item
/// actif mis en valeur par un trait courbe reliant le logo à l'item), adapté
/// à la palette sombre/ambre de Vuel.
class VuelFloatingNavBar extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onTap;
  final List<VuelNavItem> items;
  final String logoAsset;

  const VuelFloatingNavBar({
    super.key,
    required this.currentIndex,
    required this.onTap,
    required this.items,
    required this.logoAsset,
  });

  @override
  Widget build(BuildContext context) {
    const barHeight = 64.0;
    const logoDiameter = 52.0;
    const logoLeftInset = 10.0;
    // Espace réservé à gauche pour laisser respirer le logo qui déborde du bord.
    const leadingGap = logoLeftInset + logoDiameter - 6;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: SizedBox(
        height: barHeight + 14,
        child: Stack(
          clipBehavior: Clip.none,
          alignment: Alignment.bottomCenter,
          children: [
            // La pilule elle-même, avec l'ombre qui la fait "flotter".
            Container(
              height: barHeight,
              margin: EdgeInsets.only(left: leadingGap - 24),
              decoration: BoxDecoration(
                color: VuelColors.surface,
                borderRadius: BorderRadius.circular(barHeight / 2),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.45),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: LayoutBuilder(
                builder: (context, constraints) {
                  return Padding(
                    padding: EdgeInsets.only(left: leadingGap, right: 14),
                    child: Row(
                      children: List.generate(items.length, (i) {
                        final active = i == currentIndex;
                        return Expanded(
                          child: _NavItemButton(
                            item: items[i],
                            active: active,
                            onTap: () => onTap(i),
                          ),
                        );
                      }),
                    ),
                  );
                },
              ),
            ),
            // Le logo circulaire, positionné pour déborder du bord gauche.
            Positioned(
              left: logoLeftInset,
              bottom: 7,
              child: Container(
                width: logoDiameter,
                height: logoDiameter,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: VuelColors.bg,
                  border: Border.all(color: VuelColors.amber, width: 2),
                  boxShadow: [
                    BoxShadow(color: Colors.black.withValues(alpha: 0.5), blurRadius: 10, offset: const Offset(0, 4)),
                  ],
                ),
                padding: const EdgeInsets.all(9),
                child: ClipOval(child: Image.asset(logoAsset, fit: BoxFit.cover)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavItemButton extends StatelessWidget {
  final VuelNavItem item;
  final bool active;
  final VoidCallback onTap;

  const _NavItemButton({required this.item, required this.active, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final color = active ? VuelColors.amber : VuelColors.muted;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(30),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: active ? VuelColors.amberDim : Colors.transparent,
          borderRadius: BorderRadius.circular(30),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(item.icon, color: color, size: 20),
            const SizedBox(height: 3),
            Text(
              item.label,
              style: TextStyle(color: color, fontSize: 10, fontWeight: active ? FontWeight.w600 : FontWeight.normal),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
