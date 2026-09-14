import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { DuelsService } from '../duels/duels.service';
import { ReputationService } from '../reputation/reputation.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { EscrowService } from '../escrow/escrow.service';
import { CreateDisputeDto, ResolveDisputeDto } from './dto/disputes.dto';

@Injectable()
export class DisputesService {
  constructor(
    private prisma: PrismaService,
    private duelsService: DuelsService,
    private reputation: ReputationService,
    private tournamentsService: TournamentsService,
    private escrow: EscrowService,
  ) {}

  async report(userId: string, dto: CreateDisputeDto) {
    await this.prisma.duel.update({ where: { id: dto.duelId }, data: { status: 'DISPUTED' } });
    return this.prisma.dispute.create({
      data: { duelId: dto.duelId, reportedById: userId, reason: dto.reason },
    });
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

    return this.prisma.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'RESOLVED',
        resolution: dto.resolution,
        arbiterId,
        resolvedAt: new Date(),
      },
    });
  }
}
