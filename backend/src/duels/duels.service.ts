import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { EscrowService } from '../escrow/escrow.service';
import { UserNotificationsService } from '../user-notifications/user-notifications.service';
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
    private userNotifications: UserNotificationsService,
  ) {}

  // Liste complète pour le back-office admin (contrairement à listOpen()/listMine()
  // ci-dessus, qui filtrent par statut/joueur pour l'usage côté app) — inclut les
  // pseudos des deux joueurs pour affichage direct, sans exposer leurs données
  // sensibles (wallet, téléphone...). Filtre optionnel par statut pour ne pas
  // devoir charger tous les duels COMPLETED/CANCELLED à chaque ouverture de page.
  listForAdmin(status?: string) {
    return this.prisma.duel.findMany({
      where: status ? { status: status as any } : {},
      include: {
        playerA: { select: { id: true, pseudo: true } },
        playerB: { select: { id: true, pseudo: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  listOpen(game?: string) {
    return this.prisma.duel.findMany({
      where: { status: 'OPEN', ...(game ? { game: game as any } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  // BUG CORRIGÉ ICI (symptôme signalé : "je sors du salon et le duel a
  // disparu de partout, comme s'il n'avait jamais existé"). Cause : listOpen
  // ci-dessus ne renvoie QUE les duels au statut OPEN (en attente d'un
  // adversaire) — dès qu'un duel passe en IN_PROGRESS (les deux joueurs ont
  // lancé la partie), il disparaît de cette liste. Comme l'app ne consultait
  // que listOpen(), un joueur qui quittait l'écran du salon en cours de duel
  // (bouton retour) n'avait plus AUCUN moyen d'y retourner — le duel
  // continuait bel et bien à exister côté serveur, juste invisible côté app.
  // listMine comble ce trou : tous les duels (OPEN/IN_PROGRESS/DISPUTED) où
  // l'utilisateur est un des deux joueurs, pour permettre de rouvrir un salon
  // en cours (cf. PlayTab, section "Tes duels en cours").
  listMine(userId: string) {
    return this.prisma.duel.findMany({
      where: {
        OR: [{ playerAId: userId }, { playerBId: userId }],
        status: { in: ['OPEN', 'IN_PROGRESS', 'DISPUTED'] },
      },
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

  // Même résolution que resolveDuel ci-dessus, mais ne renvoie que l'id
  // canonique (pas le duel complet) — utilisé par TelegramCommandsService
  // pour retrouver le duel depuis la légende de la capture, qui affiche
  // désormais le joinCode (plus lisible qu'un UUID pour un admin) plutôt que
  // l'UUID technique. Public contrairement à resolveDuel : seule méthode de
  // ce service appelée depuis l'extérieur du module Duels.
  async resolveToId(idOrCode: string): Promise<string | null> {
    const cleaned = idOrCode.trim();
    const where: Prisma.DuelWhereUniqueInput = UUID_RE.test(cleaned)
      ? { id: cleaned }
      : { joinCode: cleaned.toUpperCase() };
    const duel = await this.prisma.duel.findUnique({ where, select: { id: true } });
    return duel?.id ?? null;
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

    const updated = await this.prisma.duel.update({
      where: { id: duelId },
      data: {
        playerBId: userId,
        playerBTeam: duel.game === 'EFOOTBALL' ? dto.playerBTeam : null,
      },
    });

    // Notifie le créateur du salon (playerA) : jusqu'ici il n'avait aucun
    // moyen de savoir qu'un adversaire l'a rejoint sans avoir l'app ouverte
    // sur l'écran du salon (cf. DuelRoomGateway.joinDuel, temps réel mais
    // seulement si connecté à CE salon précis).
    await this.userNotifications.notify(
      duel.playerAId,
      'DUEL_OPPONENT_JOINED',
      'Adversaire trouvé ⚡',
      `Un adversaire a rejoint ton salon (${duel.mode}, mise ${duel.stakeAmount} FCFA). Rejoins le salon pour lancer la partie.`,
      { duelId, joinCode: duel.joinCode },
    );

    return updated;
  }

  // Les deux joueurs doivent être prêts avant le lancement (état géré côté chat/salon en temps réel,
  // ex: WebSocket Gateway non détaillé ici).
  async start(duelId: string) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    if (!duel.playerBId) throw new BadRequestException('En attente du second joueur');

    // Déjà lancé (double clic / les deux joueurs ont cliqué / retry socket) : no-op idempotent.
    if (duel.status !== 'OPEN') return duel;

    // Prise atomique du lancement : un seul appel concurrent obtient count === 1,
    // les autres sortent sans toucher à l'escrow (évite l'erreur d'unicité sur Escrow.duelId).
    const claimed = await this.prisma.duel.updateMany({
      where: { id: duelId, status: 'OPEN' },
      data: { status: 'IN_PROGRESS' },
    });
    if (claimed.count === 0) {
      return this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    }

    // Un match de bracket de tournoi n'a pas d'escrow propre : la mise a déjà été
    // collectée à l'inscription au tournoi (cf. TournamentsService.join/finalize).
    if (!duel.tournamentId) {
      try {
        await this.escrow.lock(duelId);
      } catch (e) {
        // Échec du verrouillage (ex: solde insuffisant) : on remet le duel en OPEN pour permettre un nouvel essai.
        await this.prisma.duel.update({ where: { id: duelId }, data: { status: 'OPEN' } });
        throw e;
      }
    }

    return this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
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
  // l'escrow avait déjà été verrouillé. Autorisé par l'un ou l'autre des deux joueurs
  // — cf. adminCancel ci-dessous pour l'annulation par un admin/arbitre (aucune
  // restriction de participant, utilisée depuis le back-office) — tant que le duel
  // n'est pas déjà COMPLETED (un match déjà réglé ne peut plus être annulé).
  async cancel(duelId: string, requesterId: string) {
    const duel = await this.assertCancellable(duelId);
    const isParticipant = requesterId === duel.playerAId || requesterId === duel.playerBId;
    if (!isParticipant) {
      throw new BadRequestException('Seuls les joueurs du duel (ou un admin via les litiges) peuvent l\'annuler');
    }

    return this.escrow.refund(duelId);
  }

  // Même annulation, déclenchée depuis le back-office admin (cf. AdminController) :
  // aucune vérification de participant, un admin peut annuler n'importe quel duel
  // (ex: salon resté coincé, litige entre les joueurs réglé en dehors du système,
  // abus signalé). Rembourse les deux joueurs si l'escrow avait été verrouillé,
  // exactement comme un litige tranché avec voidMatch (cf. DisputesService.resolve).
  async adminCancel(duelId: string) {
    await this.assertCancellable(duelId);
    return this.escrow.refund(duelId);
  }

  // Vérifications communes à cancel()/adminCancel() : un duel de tournoi ne peut
  // pas être annulé isolément (les mises sont mutualisées au niveau du tournoi
  // entier, cf. TournamentsService.cancel) et un duel déjà COMPLETED/CANCELLED ne
  // peut plus l'être. Renvoie le duel pour éviter un second aller-retour en base
  // côté appelant.
  private async assertCancellable(duelId: string) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId } });
    if (duel.tournamentId) {
      throw new BadRequestException('Duel de tournoi : utiliser TournamentsService.cancel sur le tournoi entier');
    }
    if (duel.status === 'COMPLETED' || duel.status === 'CANCELLED') {
      throw new BadRequestException('Ce duel est déjà terminé ou annulé');
    }
    return duel;
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
