import { Prisma } from '@prisma/client';
import { BadRequestException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DuelRoomGateway } from '../duels/duel-room.gateway';
import { UserNotificationsService } from '../user-notifications/user-notifications.service';

const COMMISSION_RATE = 0.10; // 10%, cf. cahier des charges

@Injectable()
export class EscrowService {
  constructor(
    private prisma: PrismaService,
    // forwardRef : DuelsModule instancie DuelRoomGateway ET EscrowService dans le
    // même module (cf. duels.module.ts) — sans forwardRef, Nest résout les
    // providers dans l'ordre de déclaration et l'un des deux ne serait pas
    // encore construit au moment de l'injection.
    @Inject(forwardRef(() => DuelRoomGateway)) private duelRoomGateway: DuelRoomGateway,
    private userNotifications: UserNotificationsService,
  ) {}

  // Bloque la mise des deux joueurs dès le lancement du duel.
  async lock(duelId: string) {
    // Idempotence : si l'escrow existe déjà, ne rien refaire (ni débit, ni create).
    const existing = await this.prisma.escrow.findUnique({ where: { duelId } });
    if (existing) return existing;

    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    const totalLocked = duel.stakeAmount * 2;

    // Vérification AVANT toute écriture : un solde ne doit jamais pouvoir
    // passer sous 0. On contrôle les deux joueurs d'un coup plutôt que dans
    // la boucle de verrouillage plus bas, pour ne jamais débiter le premier
    // joueur si le second s'avère insuffisamment approvisionné (état
    // incohérent à moitié verrouillé). Message spécifique (pas un "erreur
    // serveur" générique) pour que l'appelant sache exactement quoi faire.
    const players = [duel.playerAId, duel.playerBId].filter((id): id is string => !!id);
    const wallets = await Promise.all(
      players.map((playerId) => this.prisma.wallet.findUniqueOrThrow({ where: { userId: playerId } })),
    );
    const short = wallets.find((w) => w.balanceAvailable < duel.stakeAmount);
    if (short) {
      const manque = duel.stakeAmount - short.balanceAvailable;
      throw new BadRequestException(
        `Solde insuffisant pour lancer ce duel : il manque ${manque} F sur le compte du joueur concerné (mise requise : ${duel.stakeAmount} F).`,
      );
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const playerId of players) {
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: playerId } });
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balanceAvailable: { decrement: duel.stakeAmount },
            balanceLocked: { increment: duel.stakeAmount },
          },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            type: 'ESCROW_LOCK',
            amount: duel.stakeAmount,
            status: 'SUCCESS',
          },
        });
      }

      return tx.escrow.create({
        data: { duelId, amountLocked: totalLocked, commissionRate: COMMISSION_RATE },
      });
    });
  }

  // Libère les fonds vers le gagnant une fois le score validé (OCR ou arbitrage Telegram).
  // La mise du perdant (déjà verrouillée, donc déjà à balanceAvailable >= 0 par
  // construction — cf. lock() ci-dessus) est directement transférée au gagnant :
  // aucun solde ne peut donc devenir négatif à cette étape, on ne fait que
  // déplacer un montant déjà réservé.
  async release(duelId: string, winnerId: string) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    const escrow = await this.prisma.escrow.findUniqueOrThrow({ where: { duelId } });
    const commission = Math.round(escrow.amountLocked * escrow.commissionRate);
    const payout = escrow.amountLocked - commission;
    const loserId = winnerId === duel.playerAId ? duel.playerBId : duel.playerAId;

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const winnerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: winnerId } });
      await tx.wallet.update({
        where: { id: winnerWallet.id },
        data: {
          balanceAvailable: { increment: payout },
          balanceLocked: { decrement: duel.stakeAmount }, // sa propre mise déverrouillée
        },
      });
      await tx.transaction.createMany({
        data: [
          { walletId: winnerWallet.id, type: 'ESCROW_RELEASE', amount: payout, status: 'SUCCESS' },
          { walletId: winnerWallet.id, type: 'COMMISSION', amount: commission, status: 'SUCCESS' },
        ],
      });

      if (loserId) {
        const loserWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: loserId } });
        await tx.wallet.update({
          where: { id: loserWallet.id },
          data: { balanceLocked: { decrement: duel.stakeAmount } }, // mise perdue, non recréditée
        });
      }

      await tx.escrow.update({ where: { duelId }, data: { releasedAt: new Date() } });
      await tx.duel.update({ where: { id: duelId }, data: { status: 'COMPLETED', winnerId } });

      return { payout, commission };
    });
    // Hors transaction (le socket ne doit pas attendre/dépendre du commit
    // SQL) : prévient le salon temps réel que la délibération est terminée,
    // pour que le client ferme sa bulle de capture Android automatiquement.
    this.duelRoomGateway.notifyDuelResolved(duelId, 'COMPLETED', winnerId);

    // Notification "grande étape" au gagnant ET au perdant — SEUL point de
    // passage pour un duel réglé (OCR auto, arbitrage Telegram, page admin ou
    // litige tranché, cf. DisputesService.resolve → duelsService.complete →
    // ici), donc suffisant pour couvrir les 4 chemins sans dupliquer l'appel
    // ailleurs.
    await this.userNotifications.notify(
      winnerId,
      'DUEL_WON',
      'Duel gagné 🏆',
      `Tu as remporté ton duel ! +${result.payout} FCFA crédités sur ton solde.`,
      { duelId, amount: result.payout },
    );
    if (loserId) {
      await this.userNotifications.notify(
        loserId,
        'DUEL_LOST',
        'Duel perdu',
        `Tu as perdu ce duel — ta mise de ${duel.stakeAmount} FCFA n'est pas remboursée.`,
        { duelId, amount: duel.stakeAmount },
      );
    }
    return result;
  }

  // Annule le duel et rend leur mise aux DEUX joueurs, sans commission — utilisé
  // quand un match est invalidé plutôt que tranché (ex: litige non tranchable,
  // les deux joueurs sont d'accord pour annuler, désistement avant la fin).
  async refund(duelId: string) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    const escrow = await this.prisma.escrow.findUnique({ where: { duelId } });
    if (!escrow) {
      // Pas d'escrow créé (duel jamais lancé) → rien à rembourser, juste annuler.
      const cancelled = await this.prisma.duel.update({ where: { id: duelId }, data: { status: 'CANCELLED' } });
      this.duelRoomGateway.notifyDuelResolved(duelId, 'CANCELLED');
      await this.notifyCancellation(duel);
      return cancelled;
    }
    if (escrow.releasedAt) {
      // Une Error brute serait remontée au client comme un 500 générique
      // ("Internal server error"), en perdant le message précis — on utilise
      // une exception HTTP explicite pour que l'appelant sache exactement
      // pourquoi le remboursement est refusé.
      throw new BadRequestException('Escrow déjà libéré pour ce duel — remboursement impossible.');
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const playerId of [duel.playerAId, duel.playerBId]) {
        if (!playerId) continue;
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: playerId } });
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balanceAvailable: { increment: duel.stakeAmount },
            balanceLocked: { decrement: duel.stakeAmount },
          },
        });
        await tx.transaction.create({
          data: { walletId: wallet.id, type: 'REFUND', amount: duel.stakeAmount, status: 'SUCCESS' },
        });
      }

      await tx.escrow.update({ where: { duelId }, data: { releasedAt: new Date() } });
      return tx.duel.update({ where: { id: duelId }, data: { status: 'CANCELLED' } });
    });
    this.duelRoomGateway.notifyDuelResolved(duelId, 'CANCELLED');
    await this.notifyCancellation(duel);
    return result;
  }

  // Notifie les deux joueurs (mise remboursée ou duel jamais lancé) — couvre
  // annulation par un joueur, par un admin, et litige tranché avec voidMatch
  // (cf. DisputesService.resolve), tous passant par refund() ci-dessus.
  private async notifyCancellation(duel: { id: string; playerAId: string; playerBId: string | null; stakeAmount: number }) {
    for (const playerId of [duel.playerAId, duel.playerBId]) {
      if (!playerId) continue;
      await this.userNotifications.notify(
        playerId,
        'DUEL_CANCELLED',
        'Duel annulé',
        `Ce duel a été annulé — ta mise de ${duel.stakeAmount} FCFA a été remboursée sur ton solde.`,
        { duelId: duel.id },
      );
    }
  }
}
