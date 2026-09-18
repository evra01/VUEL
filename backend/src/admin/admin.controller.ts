import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../common/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { DuelsService } from '../duels/duels.service';
import { PaymentConfigService } from '../payments/payment-config.service';
import { WITHDRAWAL_STATUS_LABELS, withdrawalStatusLabel } from '../wallet/withdrawal-status.util';
import { AdjustWalletDto, MarkWithdrawalOtherDto, SetUserRoleDto } from './dto/admin.dto';

// Réservé aux comptes ADMIN uniquement — contrairement au back-office litiges,
// accessible aussi aux ARBITER (cf. disputes.controller.ts).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private prisma: PrismaService,
    private walletService: WalletService,
    private duelsService: DuelsService,
    private paymentConfig: PaymentConfigService,
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

  // État du monitor externe vuel_wave_monitor.py (cf. WaveMonitorStatus,
  // alimenté par POST /webhooks/payment-confirmation/heartbeat) — la page
  // "Wave Monitor" du back-office s'en sert pour afficher si le script tourne
  // encore (lastSeenAt récent = OK) plutôt que de le découvrir seulement
  // quand des dépôts s'accumulent en PENDING sans être validés.
  @Get('wave-monitor')
  async waveMonitorStatus() {
    const [status, pendingDeposits, config] = await Promise.all([
      this.prisma.waveMonitorStatus.findUnique({ where: { id: 'singleton' } }),
      this.prisma.transaction.count({ where: { type: 'DEPOSIT', provider: 'wave', status: 'PENDING' } }),
      this.paymentConfig.getMasked(),
    ]);
    return {
      configured: config.webhookSharedSecretConfigured,
      lastSeenAt: status?.lastSeenAt ?? null,
      waveSessionActive: status?.waveSessionActive ?? false,
      waveExpiresAt: status?.waveExpiresAt ?? null,
      lastCycleValidated: status?.lastCycleValidated ?? 0,
      totalValidated: status?.totalValidated ?? 0,
      lastError: status?.lastError ?? null,
      pendingDeposits,
    };
  }

  // Génère un nouveau secret partagé et l'enregistre directement (remplace
  // l'ancien) — renvoyé UNE SEULE fois en clair dans cette réponse, à copier
  // immédiatement dans la variable d'environnement VUEL_WEBHOOK_SECRET du
  // monitor (cf. vuel_wave_monitor.py). Ensuite, comme tout secret,
  // GET /admin/payment-config ne renvoie plus que webhookSharedSecretConfigured: true.
  @Post('wave-monitor/generate-secret')
  async generateWaveMonitorSecret() {
    const secret = randomBytes(24).toString('hex');
    await this.paymentConfig.update({ webhookSharedSecret: secret });
    return { webhookSharedSecret: secret };
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
  // chaque retrait "En cours" (PENDING) est de l'argent réellement en attente
  // d'être envoyé au joueur (Wave/Orange Money/MTN MoMo) HORS de l'app par un
  // admin, faute d'intégration de paiement automatique côté sortant (cf. TODO
  // dans WalletService.withdraw — seuls les dépôts sont automatisés via Wave
  // Checkout). Statuts possibles pour un retrait : "En cours" (PENDING),
  // "Effectué" (SUCCESS), "Annulé" (CANCELLED) ou "Autre" (OTHER) — cf.
  // withdrawal-status.util.ts. `statusLabel` est ajouté à chaque ligne pour
  // affichage direct côté back-office, sans dupliquer le mapping côté client.
  @Get('withdrawals')
  async listWithdrawals() {
    const withdrawals = await this.prisma.transaction.findMany({
      where: { type: 'WITHDRAW' },
      include: { wallet: { include: { user: { select: { id: true, pseudo: true, phone: true } } } } },
      orderBy: { createdAt: 'desc' },
    });
    return withdrawals.map((tx) => ({ ...tx, statusLabel: withdrawalStatusLabel(tx.status) }));
  }

  // Les 4 statuts valides pour un retrait, avec leur libellé FR — utile pour
  // construire un filtre/select côté back-office sans dupliquer le mapping.
  @Get('withdrawals/statuses')
  withdrawalStatuses() {
    return WITHDRAWAL_STATUS_LABELS;
  }

  // À utiliser une fois que l'admin a effectivement envoyé les fonds au
  // joueur par le moyen convenu (Wave, Orange Money, MTN MoMo...) — ne
  // touche pas au solde : celui-ci a déjà été débité à la demande de retrait.
  // Statut résultant : "Effectué" (SUCCESS).
  @Post('withdrawals/:id/approve')
  async approveWithdrawal(@Param('id') id: string) {
    const tx = await this.assertPendingWithdrawal(id);
    return this.prisma.transaction.update({ where: { id }, data: { status: 'SUCCESS' } });
  }

  // À utiliser quand le retrait ne peut pas être honoré (ex: coordonnées de
  // paiement invalides, solde crédité par erreur) — recrédite le solde
  // disponible du joueur puisqu'il avait été débité à la demande. Statut
  // résultant : "Annulé" (CANCELLED, distinct de FAILED qui reste réservé
  // aux dépôts Wave rejetés).
  @Post('withdrawals/:id/reject')
  async rejectWithdrawal(@Param('id') id: string, @Body() dto: MarkWithdrawalOtherDto) {
    const tx = await this.assertPendingWithdrawal(id);

    return this.prisma.$transaction(async (txClient: Prisma.TransactionClient) => {
      await txClient.wallet.update({
        where: { id: tx.walletId },
        data: { balanceAvailable: { increment: tx.amount } },
      });
      return txClient.transaction.update({
        where: { id },
        data: { status: 'CANCELLED', adminNote: dto?.note },
      });
    });
  }

  // Statut "Autre" (OTHER) : pour un cas qui ne rentre ni dans "Effectué" ni
  // dans "Annulé" (ex: viré au joueur en dehors du flux normal, litige en
  // cours sur ce retrait précis...). Contrairement à "Annulé", ne recrédite
  // PAS le solde — c'est à l'admin de le faire séparément via
  // wallet-adjustment si besoin, pour éviter un recrédit implicite non
  // souhaité dans un cas déjà "autre" par définition.
  @Post('withdrawals/:id/other')
  async markWithdrawalOther(@Param('id') id: string, @Body() dto: MarkWithdrawalOtherDto) {
    await this.assertPendingWithdrawal(id);
    return this.prisma.transaction.update({
      where: { id },
      data: { status: 'OTHER', adminNote: dto?.note },
    });
  }

  private async assertPendingWithdrawal(id: string) {
    const tx = await this.prisma.transaction.findUniqueOrThrow({ where: { id } });
    if (tx.type !== 'WITHDRAW') {
      throw new BadRequestException('Cette transaction n\'est pas un retrait.');
    }
    if (tx.status !== 'PENDING') {
      throw new BadRequestException(
        `Ce retrait est déjà "${withdrawalStatusLabel(tx.status)}" — aucune action possible.`,
      );
    }
    return tx;
  }

  // Liste des duels pour supervision — ?status=OPEN|IN_PROGRESS|AWAITING_PROOF|
  // DISPUTED|COMPLETED|CANCELLED permet de filtrer (ex: n'afficher que les duels
  // en cours), sinon renvoie tout. Utilisé par la page "Duels" du back-office,
  // notamment pour repérer un salon resté coincé à annuler manuellement.
  @Get('duels')
  listDuels(@Query('status') status?: string) {
    return this.duelsService.listForAdmin(status);
  }

  // Annulation forcée par un admin — contrairement à POST /duels/:id/cancel
  // (réservé aux deux joueurs du duel), aucune vérification de participant :
  // utile pour un salon coincé (ex: un joueur a quitté l'app sans jamais lancer
  // la partie) ou un abus signalé hors du circuit litige normal. Rembourse les
  // deux joueurs si la mise avait déjà été verrouillée (cf. DuelsService.adminCancel).
  // Refusé pour un duel de tournoi (message explicite) et pour un duel déjà
  // COMPLETED/CANCELLED.
  @Post('duels/:id/cancel')
  cancelDuel(@Param('id') id: string) {
    return this.duelsService.adminCancel(id);
  }
}
