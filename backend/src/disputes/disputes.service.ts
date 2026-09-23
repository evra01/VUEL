import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DuelsService } from '../duels/duels.service';
import { ReputationService } from '../reputation/reputation.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { EscrowService } from '../escrow/escrow.service';
import { UserNotificationsService } from '../user-notifications/user-notifications.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/disputes.dto';

@Injectable()
export class DisputesService {
  constructor(
    private prisma: PrismaService,
    private duelsService: DuelsService,
    private reputation: ReputationService,
    private tournamentsService: TournamentsService,
    private escrow: EscrowService,
    private userNotifications: UserNotificationsService,
  ) {}

  async report(userId: string, dto: CreateDisputeDto) {
    const duel = await this.prisma.duel.update({
      where: { id: dto.duelId },
      data: { status: 'DISPUTED' },
    });
    const dispute = await this.prisma.dispute.create({
      data: { duelId: dto.duelId, reportedById: userId, reason: dto.reason },
    });

    // Notifie l'AUTRE joueur — celui qui a signalé le litige sait déjà qu'il
    // vient de le faire, inutile de le renotifier lui-même.
    const otherPlayerId = userId === duel.playerAId ? duel.playerBId : duel.playerAId;
    if (otherPlayerId) {
      await this.userNotifications.notify(
        otherPlayerId,
        'DISPUTE_OPENED',
        'Litige ouvert ⚠️',
        `Un litige a été ouvert sur ton duel. Un arbitre va examiner le dossier.`,
        { duelId: dto.duelId, disputeId: dispute.id },
      );
    }

    return dispute;
  }

  listOpen() {
    return this.prisma.dispute.findMany({
      where: { status: { in: ['OPEN', 'REVIEWING'] } },
      include: { duel: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Dossier complet pour l'arbitre : duel, mise, les deux captures + résultat OCR, litige.
  // Le tchat privé du salon n'est pas persisté côté serveur pour l'instant (cf. DuelRoomGateway,
  // TODO à ajouter si le contenu du chat doit servir de preuve en cas de litige).
  async getCaseFile(disputeId: string) {
    const dispute = await this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: {
        duel: {
          include: {
            proofs: { orderBy: { submittedAt: 'asc' } },
            escrow: true,
            playerA: { select: { id: true, pseudo: true, reputationScore: true } },
            playerB: { select: { id: true, pseudo: true, reputationScore: true } },
          },
        },
        reportedBy: { select: { id: true, pseudo: true } },
      },
    });

    if (dispute.status === 'OPEN') {
      await this.prisma.dispute.update({ where: { id: disputeId }, data: { status: 'REVIEWING' } });
    }

    return dispute;
  }

  // Décision manuelle d'un arbitre : soit désigne le gagnant (déclenche la libération
  // d'escrow, ou l'avancement du bracket si c'est un duel de tournoi), soit annule le
  // match et rembourse les deux joueurs (dto.voidMatch) si le litige n'est pas
  // tranchable. Applique une sanction de réputation au joueur fautif le cas échéant.
  async resolve(disputeId: string, arbiterId: string, dto: ResolveDisputeDto) {
    const dispute = await this.prisma.dispute.findUniqueOrThrow({
      where: { id: disputeId },
      include: { duel: true },
    });

    if (dto.voidMatch) {
      if (dispute.duel.tournamentId) {
        throw new BadRequestException(
          'Impossible d\'annuler un seul match de tournoi (les mises sont mutualisées) — ' +
            'annule le tournoi entier via TournamentsService.cancel si nécessaire.',
        );
      }
      await this.escrow.refund(dispute.duelId);
    } else {
      if (!dto.winnerId) throw new BadRequestException('winnerId requis quand voidMatch n\'est pas activé');
      if (dispute.duel.tournamentId) {
        await this.tournamentsService.reportMatchResult(dispute.duelId, dto.winnerId);
      } else {
        await this.duelsService.complete(dispute.duelId, dto.winnerId);
      }
    }

    if (dto.sanctionUserId) {
      await this.reputation.applySanction(dto.sanctionUserId, dto.resolution);
    }

    const resolved = await this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED',
        resolution: dto.resolution,
        arbiterId,
        resolvedAt: new Date(),
      },
    });

    // Complète les notifications DUEL_WON/DUEL_LOST/DUEL_CANCELLED déjà
    // envoyées ci-dessus (via duelsService.complete/escrow.refund → EscrowService)
    // avec le contexte "litige résolu" — sans ça, un joueur recevrait juste
    // "duel gagné/perdu" sans savoir que c'est un arbitre qui a tranché.
    for (const playerId of [dispute.duel.playerAId, dispute.duel.playerBId]) {
      if (!playerId) continue;
      await this.userNotifications.notify(
        playerId,
        'DISPUTE_RESOLVED',
        'Litige résolu',
        dto.resolution
          ? `Le litige sur ton duel a été tranché par un arbitre : ${dto.resolution}`
          : `Le litige sur ton duel a été tranché par un arbitre.`,
        { duelId: dispute.duelId, disputeId },
      );
    }

    return resolved;
  }
}
