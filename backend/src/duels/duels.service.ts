import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EscrowService } from '../escrow/escrow.service';
import { CreateDuelDto, JoinDuelDto } from './dto/duels.dto';

@Injectable()
export class DuelsService {
  constructor(
    private prisma: PrismaService,
    private escrow: EscrowService,
  ) {}

  listOpen(game?: string) {
    return this.prisma.duel.findMany({
      where: { status: 'OPEN', ...(game ? { game: game as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(userId: string, dto: CreateDuelDto) {
    return this.prisma.duel.create({
      data: {
        game: dto.game,
        mode: dto.mode,
        stakeAmount: dto.stakeAmount,
        // Ignoré hors EFOOTBALL (cf. CreateDuelDto) — jamais stocké pour les
        // autres jeux, même si fourni, pour éviter tout faux-positif dans le
        // matching de nom d'équipe côté OCR (cf. teamsMatch).
        playerATeam: dto.game === 'EFOOTBALL' ? dto.playerATeam : null,
        playerAId: userId,
        status: 'OPEN',
      },
    });
  }

  async join(userId: string, duelId: string, dto: JoinDuelDto) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    if (duel.status !== 'OPEN') throw new BadRequestException('Salon non disponible');
    if (duel.playerAId === userId) throw new BadRequestException('Impossible de rejoindre son propre salon');

    // Nom d'équipe obligatoire uniquement pour EFOOTBALL (cf. JoinDuelDto) —
    // le jeu vient du duel existant, pas du payload envoyé ici, donc la
    // vérification conditionnelle se fait à ce niveau plutôt que dans le DTO.
    if (duel.game === 'EFOOTBALL' && !dto.playerBTeam) {
      throw new BadRequestException("Le nom de ton équipe est requis pour rejoindre un duel eFootball");
    }

    return this.prisma.duel.update({
      where: { id: duelId },
      data: {
        playerBId: userId,
        playerBTeam: duel.game === 'EFOOTBALL' ? dto.playerBTeam : null,
      },
    });
  }

  // Les deux joueurs doivent être prêts avant le lancement (état géré côté chat/salon en temps réel,
  // ex: WebSocket Gateway non détaillé ici).
  async start(duelId: string) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    if (!duel.playerBId) throw new BadRequestException('En attente du second joueur');

    // Un match de bracket de tournoi n'a pas d'escrow propre : la mise a déjà été
    // collectée à l'inscription au tournoi (cf. TournamentsService.join/finalize).
    if (!duel.tournamentId) {
      await this.escrow.lock(duelId);
    }

    return this.prisma.duel.update({
      where: { id: duelId },
      data: { status: 'IN_PROGRESS' },
    });
  }

  async markAwaitingProof(duelId: string) {
    return this.prisma.duel.update({
      where: { id: duelId },
      data: { status: 'AWAITING_PROOF' },
    });
  }

  // Ne pas utiliser sur un duel de tournoi — cf. TournamentsService.reportMatchResult,
  // appelé à la place par OcrProcessor/DisputesService quand duel.tournamentId est renseigné.
  async complete(duelId: string, winnerId: string) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    if (duel.tournamentId) {
      throw new BadRequestException(
        'Duel de tournoi : utiliser TournamentsService.reportMatchResult, pas DuelsService.complete',
      );
    }
    return this.escrow.release(duelId, winnerId);
  }

  // Annule un duel classique (hors tournoi) et rend leur mise aux deux joueurs si
  // l'escrow avait déjà été verrouillé. Autorisé par l'un ou l'autre des deux joueurs,
  // ou par un admin/arbitre (cf. DuelsController) — tant que le duel n'est pas déjà
  // COMPLETED (un match déjà réglé ne peut plus être annulé).
  async cancel(duelId: string, requesterId: string) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    if (duel.tournamentId) {
      throw new BadRequestException('Duel de tournoi : utiliser TournamentsService.cancel sur le tournoi entier');
    }
    if (duel.status === 'COMPLETED' || duel.status === 'CANCELLED') {
      throw new BadRequestException('Ce duel est déjà terminé ou annulé');
    }
    const isParticipant = requesterId === duel.playerAId || requesterId === duel.playerBId;
    if (!isParticipant) {
      throw new BadRequestException('Seuls les joueurs du duel (ou un admin via les litiges) peuvent l\'annuler');
    }

    return this.escrow.refund(duelId);
  }

  // Aperçu public (SANS authentification) d'un duel — alimente la page
  // d'invitation /d/:id partagée par les joueurs à leurs amis pour qu'ils
  // rejoignent le salon (cf. DuelInviteController). On n'expose QUE des infos
  // non sensibles : jamais de wallet, jamais de contact, juste de quoi donner
  // envie de rejoindre et de confirmer que le salon existe encore.
  async getPublicPreview(duelId: string) {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: { playerA: { select: { pseudo: true } } },
    });
    if (!duel) throw new NotFoundException();
    return {
      id: duel.id,
      game: duel.game,
      mode: duel.mode,
      stakeAmount: duel.stakeAmount,
      status: duel.status,
      creatorPseudo: duel.playerA?.pseudo ?? 'Un joueur',
    };
  }

  async get(duelId: string) {
    const duel = await this.prisma.duel.findUnique({
      where: { id: duelId },
      include: { escrow: true, proofs: true, dispute: true },
    });
    if (!duel) throw new NotFoundException();
    return duel;
  }
}
