import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EscrowService } from '../escrow/escrow.service';
import { CreateDuelDto, JoinDuelDto } from './dto/duels.dto';

// UUID v4 (format de Duel.id, généré par Prisma @default(uuid())) — sert à
// distinguer un identifiant technique d'un code de salon court quand
// DuelsService.get()/getPublicPreview() reçoivent l'un ou l'autre (cf.
// DuelInviteController, et l'écran "Rejoindre avec un code" côté mobile).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Alphabet volontairement réduit pour un code facile à lire/dicter/taper à la
// main : que des majuscules, chiffres 2-9, sans caractères ambigus à
// l'affichage (0/O, 1/I/L). 6 caractères ≈ 1 milliard de combinaisons —
// largement suffisant vu le faible nombre de duels ouverts en parallèle, avec
// une nouvelle tentative en cas de collision improbable (cf. create()).
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 6;

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

  private generateJoinCode(): string {
    let code = '';
    for (let i = 0; i < JOIN_CODE_LENGTH; i++) {
      code += JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)];
    }
    return code;
  }

  // Contrainte @unique en base sur joinCode : en cas de collision (improbable
  // vu l'espace de codes, cf. JOIN_CODE_ALPHABET), on retente avec un nouveau
  // code plutôt que de faire échouer la création du salon.
  private async createWithUniqueJoinCode(data: Prisma.DuelUncheckedCreateInput) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.duel.create({ data: { ...data, joinCode: this.generateJoinCode() } });
      } catch (err: any) {
        if (err?.code === 'P2002' && attempt < 4) continue; // collision sur joinCode — on retente
        throw err;
      }
    }
    throw new BadRequestException("Impossible de générer un code de salon unique, réessaie.");
  }

  create(userId: string, dto: CreateDuelDto) {
    return this.createWithUniqueJoinCode({
      game: dto.game,
      mode: dto.mode,
      stakeAmount: dto.stakeAmount,
      // Ignoré hors EFOOTBALL (cf. CreateDuelDto) — jamais stocké pour les
      // autres jeux, même si fourni, pour éviter tout faux-positif dans le
      // matching de nom d'équipe côté OCR (cf. teamsMatch).
      playerATeam: dto.game === 'EFOOTBALL' ? dto.playerATeam : null,
      playerAId: userId,
      status: 'OPEN',
    });
  }

  // Résout un identifiant de salon qui peut être soit l'UUID technique
  // (`Duel.id`), soit le code court partagé aux joueurs (`Duel.joinCode`,
  // cf. generateJoinCode) — insensible à la casse et aux espaces pour rester
  // tolérant à la saisie manuelle. Utilisé par get()/getPublicPreview() pour
  // que le lien d'invitation ET le champ "Rejoindre avec un code" acceptent
  // le même code court sans exposer l'UUID.
  private async resolveDuel(idOrCode: string, include: Prisma.DuelInclude) {
    const cleaned = idOrCode.trim();
    const where: Prisma.DuelWhereUniqueInput = UUID_RE.test(cleaned)
      ? { id: cleaned }
      : { joinCode: cleaned.toUpperCase() };
    return this.prisma.duel.findUnique({ where, include });
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
  async getPublicPreview(duelIdOrCode: string) {
    const duel = await this.resolveDuel(duelIdOrCode, { playerA: { select: { pseudo: true } } });
    if (!duel) throw new NotFoundException();
    return {
      id: duel.id,
      joinCode: duel.joinCode,
      game: duel.game,
      mode: duel.mode,
      stakeAmount: duel.stakeAmount,
      status: duel.status,
      creatorPseudo: duel.playerA?.pseudo ?? 'Un joueur',
    };
  }

  async get(duelIdOrCode: string) {
    const duel = await this.resolveDuel(duelIdOrCode, { escrow: true, proofs: true, dispute: true });
    if (!duel) throw new NotFoundException();
    return duel;
  }
}
