import { Prisma } from '@prisma/client';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { CreateTournamentDto } from './dto/tournaments.dto';

@Injectable()
export class TournamentsService {
  constructor(private prisma: PrismaService) {}

  create(organizerId: string, dto: CreateTournamentDto) {
    return this.prisma.tournament.create({
      data: {
        name: dto.name,
        game: dto.game,
        stakeAmount: dto.stakeAmount,
        maxParticipants: dto.maxParticipants,
        organizerId,
      },
    });
  }

  // Annule le tournoi et rembourse TOUS les participants (leur mise repasse de
  // balanceLocked à balanceAvailable, sans commission). Autorisé tant que le
  // tournoi n'est pas déjà COMPLETED — y compris en cours de bracket (IN_PROGRESS) :
  // les mises restent verrouillées jusqu'à finalize(), donc rien n'a encore été
  // distribué et le remboursement reste simple et symétrique pour tout le monde.
  async cancel(userId: string, tournamentId: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: { participants: true },
    });
    if (tournament.organizerId !== userId) {
      throw new ForbiddenException('Seul l\'organisateur (ou un admin) peut annuler ce tournoi');
    }
    if (tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED') {
      throw new BadRequestException('Ce tournoi est déjà terminé ou annulé');
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const participant of tournament.participants) {
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: participant.userId } });
        await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            balanceAvailable: { increment: tournament.stakeAmount },
            balanceLocked: { decrement: tournament.stakeAmount },
          },
        });
        await tx.transaction.create({
          data: { walletId: wallet.id, type: 'REFUND', amount: tournament.stakeAmount, status: 'SUCCESS' },
        });
      }

      // Les matchs de bracket en cours n'ont pas leur propre argent à rembourser
      // (les mises sont mutualisées au niveau du tournoi, pas du duel) — on les
      // annule simplement pour qu'OCR/litiges ne les traitent plus.
      await tx.duel.updateMany({
        where: { tournamentId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
        data: { status: 'CANCELLED' },
      });

      await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'CANCELLED' } });
    });

    return this.getDetail(tournamentId);
  }

  list(game?: string) {
    return this.prisma.tournament.findMany({
      where: {
        status: { in: ['OPEN', 'IN_PROGRESS'] },
        ...(game ? { game: game as any } : {}),
      },
      include: { _count: { select: { participants: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDetail(tournamentId: string) {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      include: {
        participants: { include: { user: { select: { id: true, pseudo: true, avatarId: true } } } },
        duels: { orderBy: { tournamentRound: 'asc' } },
      },
    });
    if (!tournament) throw new NotFoundException();
    return tournament;
  }

  // Rejoindre = payer la mise immédiatement (déjà déposée dans le wallet, pas de
  // nouveau paiement Wave ici) — les fonds passent en balanceLocked jusqu'à la fin
  // du tournoi, cf. finalize().
  async join(userId: string, tournamentId: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: { _count: { select: { participants: true } } },
    });
    if (tournament.status !== 'OPEN') throw new BadRequestException('Ce tournoi n\'accepte plus d\'inscriptions');
    if (tournament._count.participants >= tournament.maxParticipants) {
      throw new BadRequestException('Tournoi complet');
    }

    const existing = await this.prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    });
    if (existing) throw new BadRequestException('Déjà inscrit à ce tournoi');

    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    if (wallet.balanceAvailable < tournament.stakeAmount) {
      throw new BadRequestException('Solde insuffisant pour la mise du tournoi');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balanceAvailable: { decrement: tournament.stakeAmount },
          balanceLocked: { increment: tournament.stakeAmount },
        },
      });
      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'TOURNAMENT_ENTRY',
          amount: tournament.stakeAmount,
          status: 'SUCCESS',
        },
      });
      await tx.tournament.update({
        where: { id: tournamentId },
        data: { prizePool: { increment: tournament.stakeAmount } },
      });
      return tx.tournamentParticipant.create({ data: { tournamentId, userId } });
    });
  }

  // Démarre le tournoi : génère les appariements du round 1. L'organisateur ou un
  // admin peut démarrer avant d'avoir atteint maxParticipants (comme la plupart des
  // apps de tournoi) dès qu'il y a au moins 2 participants.
  async start(userId: string, tournamentId: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: { participants: true },
    });
    if (tournament.organizerId !== userId) {
      throw new ForbiddenException('Seul l\'organisateur peut démarrer ce tournoi');
    }
    if (tournament.status !== 'OPEN') throw new BadRequestException('Tournoi déjà démarré ou terminé');
    if (tournament.participants.length < 2) {
      throw new BadRequestException('Il faut au moins 2 participants pour démarrer');
    }

    await this.prisma.tournament.update({
      where: { id: tournamentId },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    await this.createRoundDuels(
      tournament.id,
      tournament.game,
      1,
      tournament.participants.map((p: { userId: string }) => p.userId),
    );

    return this.getDetail(tournamentId);
  }

  // Appelé par OcrProcessor / DisputesService quand un duel de bracket se termine,
  // à la place de l'escrow habituel (pas d'argent à libérer match par match — tout
  // est réglé en une fois à la fin du tournoi, cf. finalize()).
  async reportMatchResult(duelId: string, winnerId: string) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    if (!duel.tournamentId) throw new BadRequestException('Ce duel ne fait pas partie d\'un tournoi');

    const loserId = winnerId === duel.playerAId ? duel.playerBId : duel.playerAId;

    await this.prisma.duel.update({ where: { id: duelId }, data: { status: 'COMPLETED', winnerId } });
    if (loserId) {
      await this.prisma.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId: duel.tournamentId, userId: loserId } },
        data: { eliminated: true },
      });
    }

    await this.tryAdvanceRound(duel.tournamentId, duel.tournamentRound!);
  }

  private async tryAdvanceRound(tournamentId: string, round: number) {
    const pendingInRound = await this.prisma.duel.count({
      where: { tournamentId, tournamentRound: round, status: { not: 'COMPLETED' } },
    });
    if (pendingInRound > 0) return; // d'autres matchs du round sont encore en cours

    const tournament = await this.prisma.tournament.findUniqueOrThrow({ where: { id: tournamentId } });
    const active = await this.prisma.tournamentParticipant.findMany({
      where: { tournamentId, eliminated: false },
    });

    if (active.length === 1) {
      await this.finalize(tournamentId, active[0].userId);
      return;
    }

    await this.createRoundDuels(tournamentId, tournament.game, round + 1, active.map((p: { userId: string }) => p.userId));
  }

  // Mélange les participants actifs et les apparie 1v1. En cas de nombre impair,
  // le dernier reçoit un "bye" : il passe directement au round suivant sans jouer
  // (aucun Duel créé pour lui ce round-ci).
  private async createRoundDuels(tournamentId: string, game: any, round: number, participantIds: string[]) {
    const shuffled = [...participantIds].sort(() => Math.random() - 0.5);
    const duelsData: {
      tournamentId: string;
      tournamentRound: number;
      game: any;
      mode: string;
      stakeAmount: number;
      playerAId: string;
      playerBId: string;
    }[] = [];

    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      duelsData.push({
        tournamentId,
        tournamentRound: round,
        game,
        mode: 'tournament',
        stakeAmount: 0, // déjà payé à l'inscription, pas d'escrow par match
        playerAId: shuffled[i],
        playerBId: shuffled[i + 1],
      });
    }
    // Le participant en bye (shuffled[shuffled.length - 1] si nombre impair) n'a
    // aucun Duel créé ce round : il reste simplement "eliminated: false" et sera
    // repris automatiquement au prochain appel de tryAdvanceRound.

    if (duelsData.length > 0) {
      await this.prisma.duel.createMany({ data: duelsData });
    } else {
      // Cas limite : round entièrement composé d'un bye (2 participants actifs
      // dont un bye impossible normalement, mais on protège quand même) —
      // ré-essaie de faire avancer immédiatement.
      await this.tryAdvanceRound(tournamentId, round);
    }
  }

  private async finalize(tournamentId: string, winnerId: string) {
    const tournament = await this.prisma.tournament.findUniqueOrThrow({
      where: { id: tournamentId },
      include: { participants: true },
    });

    const commission = Math.round(tournament.prizePool * tournament.commissionRate);
    const payout = tournament.prizePool - commission;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const participant of tournament.participants) {
        const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: participant.userId } });
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balanceLocked: { decrement: tournament.stakeAmount } },
        });
      }

      const winnerWallet = await tx.wallet.findUniqueOrThrow({ where: { userId: winnerId } });
      await tx.wallet.update({
        where: { id: winnerWallet.id },
        data: { balanceAvailable: { increment: payout } },
      });
      await tx.transaction.createMany({
        data: [
          { walletId: winnerWallet.id, type: 'TOURNAMENT_PAYOUT', amount: payout, status: 'SUCCESS' },
          { walletId: winnerWallet.id, type: 'COMMISSION', amount: commission, status: 'SUCCESS' },
        ],
      });

      await tx.tournament.update({
        where: { id: tournamentId },
        data: { status: 'COMPLETED', winnerId, completedAt: new Date() },
      });
    });
  }
}
