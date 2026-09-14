import { Prisma } from '@prisma/client';
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../common/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AdjustWalletDto, SetUserRoleDto } from './dto/admin.dto';

// Réservé aux comptes ADMIN uniquement — contrairement au back-office litiges,
// accessible aussi aux ARBITER (cf. disputes.controller.ts).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
  ) {}

  @Get('users')
  listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        pseudo: true,
        phone: true,
        role: true,
        reputationScore: true,
        kycStatus: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Patch('users/:id/role')
  setRole(@Param('id') id: string, @Body() dto: SetUserRoleDto) {
    return this.prisma.user.update({ where: { id }, data: { role: dto.role } });
  }

  // Ajustement manuel du solde par un admin (ex: geste commercial, correction
  // d'une erreur de dépôt, remboursement hors-flux). Toujours tracé comme une
  // Transaction (type DEPOSIT/WITHDRAW, provider 'admin') pour garder un
  // historique complet et cohérent avec les vrais dépôts/retraits Wave.
  @Post('users/:id/wallet-adjustment')
  async adjustWallet(@Param('id') id: string, @Body() dto: AdjustWalletDto) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId: id } });

    if (dto.direction === 'DEBIT' && wallet.balanceAvailable < dto.amount) {
      throw new BadRequestException('Solde disponible insuffisant pour ce débit');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balanceAvailable:
            dto.direction === 'CREDIT' ? { increment: dto.amount } : { decrement: dto.amount },
        },
      });
      return tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: dto.direction === 'CREDIT' ? 'DEPOSIT' : 'WITHDRAW',
          amount: dto.amount,
          provider: 'admin',
          status: 'SUCCESS',
        },
      });
    });
  }

  // Vue d'ensemble simple pour le tableau de bord back-office.
  @Get('stats')
  async stats() {
    const [totalUsers, openDuels, disputedDuels, totalVolumeLocked, pendingWithdrawals, pendingDeposits] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.duel.count({ where: { status: 'OPEN' } }),
      this.prisma.duel.count({ where: { status: 'DISPUTED' } }),
      this.prisma.escrow.aggregate({ _sum: { amountLocked: true }, where: { releasedAt: null } }),
      this.prisma.transaction.count({ where: { type: 'WITHDRAW', status: 'PENDING' } }),
      this.prisma.transaction.count({ where: { type: 'DEPOSIT', status: 'PENDING' } }),
    ]);
    return {
      totalUsers,
      openDuels,
      disputedDuels,
      amountCurrentlyLocked: totalVolumeLocked._sum.amountLocked ?? 0,
      pendingWithdrawals,
      pendingDeposits,
    };
  }

  // Liste des demandes de dépôt Wave (lien fixe + validation manuelle, cf.
  // WalletService.deposit) — même file d'attente que les boutons Telegram
  // "✅ Paiement reçu" / "❌ Rejeter" (cf. TelegramCommandsService), en
  // alternative depuis le back-office pour un admin qui n'a pas Telegram sous
  // la main. payerPhone est le numéro déclaré par le joueur, à recouper avec
  // le compte Wave Business avant de valider.
  @Get('deposits')
  listDeposits() {
    return this.prisma.transaction.findMany({
      where: { type: 'DEPOSIT', provider: 'wave' },
      include: { wallet: { include: { user: { select: { id: true, pseudo: true, phone: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // À utiliser une fois que l'admin a vérifié à la main que le paiement est
  // bien arrivé sur le compte Wave — crédite le wallet du joueur. Même
  // logique (idempotente) que le bouton "✅ Paiement reçu" sur Telegram, donc
  // sans risque de double-crédit si les deux canaux sont utilisés en parallèle.
  @Post('deposits/:id/approve')
  approveDeposit(@Param('id') id: string) {
    return this.walletService.approveDeposit(id);
  }

  // À utiliser quand le dépôt ne peut pas être validé (ex: paiement jamais
  // reçu, numéro erroné). Même logique (idempotente) que le bouton "❌
  // Rejeter" sur Telegram — aucun crédit.
  @Post('deposits/:id/reject')
  rejectDeposit(@Param('id') id: string) {
    return this.walletService.rejectDeposit(id);
  }

  // Liste des demandes de retrait — le montant a déjà été débité du solde
  // disponible du joueur à la création (cf. WalletService.withdraw), donc
  // chaque retrait PENDING est de l'argent réellement en attente d'être
  // envoyé au joueur (Wave/Orange Money/MTN MoMo) HORS de l'app par un admin,
  // faute d'intégration de paiement automatique côté sortant (cf. TODO dans
  // WalletService.withdraw — seuls les dépôts sont automatisés via Wave
  // Checkout). "approve"/"reject" ci-dessous sont les seules actions qui
  // permettent de faire avancer cet argent au lieu de le laisser bloqué.
  @Get('withdrawals')
  listWithdrawals() {
    return this.prisma.transaction.findMany({
      where: { type: 'WITHDRAW' },
      include: { wallet: { include: { user: { select: { id: true, pseudo: true, phone: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // À utiliser une fois que l'admin a effectivement envoyé les fonds au
  // joueur par le moyen convenu (Wave, Orange Money, MTN MoMo...) — ne
  // touche pas au solde : celui-ci a déjà été débité à la demande de retrait.
  @Post('withdrawals/:id/approve')
  async approveWithdrawal(@Param('id') id: string) {
    const tx = await this.prisma.transaction.findUniqueOrThrow({ where: { id } });
    if (tx.type !== 'WITHDRAW') {
      throw new BadRequestException('Cette transaction n\'est pas un retrait.');
    }
    if (tx.status !== 'PENDING') {
      throw new BadRequestException(`Ce retrait est déjà "${tx.status}" — aucune action possible.`);
    }
    return this.prisma.transaction.update({ where: { id }, data: { status: 'SUCCESS' } });
  }

  // À utiliser quand le retrait ne peut pas être honoré (ex: coordonnées de
  // paiement invalides, solde crédité par erreur) — recrédite le solde
  // disponible du joueur puisqu'il avait été débité à la demande.
  @Post('withdrawals/:id/reject')
  async rejectWithdrawal(@Param('id') id: string) {
    const tx = await this.prisma.transaction.findUniqueOrThrow({ where: { id } });
    if (tx.type !== 'WITHDRAW') {
      throw new BadRequestException('Cette transaction n\'est pas un retrait.');
    }
    if (tx.status !== 'PENDING') {
      throw new BadRequestException(`Ce retrait est déjà "${tx.status}" — aucune action possible.`);
    }

    return this.prisma.$transaction(async (txClient: Prisma.TransactionClient) => {
      await txClient.wallet.update({
        where: { id: tx.walletId },
        data: { balanceAvailable: { increment: tx.amount } },
      });
      return txClient.transaction.update({ where: { id }, data: { status: 'FAILED' } });
    });
  }
}
