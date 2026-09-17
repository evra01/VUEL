import { Response } from 'express';
import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Res, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../common/prisma.service';
import { DuelsService } from '../duels/duels.service';
import { EscrowService } from '../escrow/escrow.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { TelegramNotifierService } from '../notifications/telegram-notifier.service';
import { SettleDuelDto } from './dto/settle-duel.dto';

// Équivalent web de l'arbitrage Telegram (cf. TelegramCommandsService) :
// permet à un admin de valider le vainqueur (ou d'annuler) N'IMPORTE QUEL
// duel ayant reçu une preuve, directement depuis la page admin — pas
// seulement les duels déjà escaladés en litige via /admin/disputes (voir
// disputes.controller.ts, qui exige un Dispute existant). Utile quand
// l'admin préfère trancher depuis le navigateur plutôt que Telegram, ou
// simplement pour aller plus vite sans attendre l'échec de l'OCR.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'ARBITER')
@Controller('admin/proofs')
export class AdminProofsController {
  constructor(
    private prisma: PrismaService,
    private duelsService: DuelsService,
    private tournamentsService: TournamentsService,
    private escrow: EscrowService,
    private telegram: TelegramNotifierService,
  ) {}

  // Liste toutes les preuves des duels PAS ENCORE réglés (ni COMPLETED ni
  // CANCELLED) — même s'ils n'ont jamais été mis en litige. Les plus récentes
  // d'abord, pour retrouver facilement une preuve qui vient d'arriver.
  @Get()
  listPending() {
    return this.prisma.screenshotProof.findMany({
      where: { duel: { status: { notIn: ['COMPLETED', 'CANCELLED'] } } },
      include: {
        duel: {
          include: {
            playerA: { select: { id: true, pseudo: true, reputationScore: true } },
            playerB: { select: { id: true, pseudo: true, reputationScore: true } },
          },
        },
        user: { select: { id: true, pseudo: true } },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }

  // Retrouve un duel par son code court ou son UUID, MÊME sans preuve
  // envoyée — contrairement à listPending ci-dessus qui ne montre que les
  // duels avec au moins une preuve. Équivalent web de la commande Telegram
  // /debloquer <code> (cf. TelegramCommandsService.handleUnlockCommand) :
  // utile pour un duel dont les fonds restent verrouillés sans qu'aucune
  // capture n'ait jamais été envoyée (abandon en cours de match, etc).
  @Get('lookup/:codeOrId')
  async lookup(@Param('codeOrId') codeOrId: string) {
    const duelId = await this.duelsService.resolveToId(codeOrId);
    if (!duelId) throw new NotFoundException('Duel introuvable — vérifie le code.');
    return this.prisma.duel.findUniqueOrThrow({
      where: { id: duelId },
      include: {
        playerA: { select: { id: true, pseudo: true } },
        playerB: { select: { id: true, pseudo: true } },
      },
    });
  }

  // Retélécharge et sert l'image de la capture depuis Telegram (cf.
  // TelegramNotifierService.getProofImage) — l'image n'est stockée nulle
  // part sur ce serveur, uniquement relayée à la volée pour l'affichage.
  @Get(':id/image')
  async getImage(@Param('id') id: string, @Res() res: Response) {
    const proof = await this.prisma.screenshotProof.findUniqueOrThrow({ where: { id } });
    if (!proof.telegramFileId) {
      throw new NotFoundException(
        "Cette preuve n'a pas d'image associée (envoyée avant l'ajout de cette fonctionnalité, ou Telegram non configuré au moment de l'envoi).",
      );
    }
    const image = await this.telegram.getProofImage(proof.telegramFileId);
    if (!image) {
      throw new NotFoundException("Impossible de récupérer l'image depuis Telegram — le fichier a peut-être expiré ou été supprimé du canal.");
    }
    res.set('Content-Type', image.contentType);
    // Une preuve réglée ne change plus jamais d'image — autant laisser le
    // navigateur la garder en cache plutôt que la re-télécharger à chaque
    // ouverture de la page admin.
    res.set('Cache-Control', 'private, max-age=86400');
    res.send(image.buffer);
  }

  // Règle le duel : désigne le vainqueur (fonds crédités via
  // EscrowService.release, cf. DuelsService.complete) ou annule le match
  // (remboursement des deux joueurs). Si un litige existait déjà pour ce
  // duel (escaladé par l'OCR ou signalé par un joueur), il est marqué résolu
  // au passage pour ne pas rester ouvert dans /admin/disputes.
  @Post('duel/:duelId/settle')
  async settle(@Param('duelId') duelId: string, @Body() dto: SettleDuelDto) {
    const duel = await this.prisma.duel.findUniqueOrThrow({ where: { id: duelId }, include: { dispute: true } });
    if (duel.status === 'COMPLETED' || duel.status === 'CANCELLED') {
      throw new BadRequestException(`Ce duel est déjà ${duel.status === 'COMPLETED' ? 'réglé' : 'annulé'} — aucune action possible.`);
    }

    if (dto.voidMatch) {
      if (duel.tournamentId) {
        throw new BadRequestException(
          "Impossible d'annuler un seul match de tournoi ici (les mises sont mutualisées) — annule le tournoi entier depuis la page Tournois.",
        );
      }
      await this.escrow.refund(duelId);
    } else {
      if (!dto.winnerId) throw new BadRequestException('winnerId requis quand voidMatch n\'est pas activé');
      if (duel.tournamentId) {
        await this.tournamentsService.reportMatchResult(duelId, dto.winnerId);
      } else {
        await this.duelsService.complete(duelId, dto.winnerId);
      }
    }

    if (duel.dispute && (duel.dispute.status === 'OPEN' || duel.dispute.status === 'REVIEWING')) {
      await this.prisma.dispute.update({
        where: { id: duel.dispute.id },
        data: {
          status: 'RESOLVED',
          resolution: dto.voidMatch ? 'Match annulé depuis la page admin (Preuves)' : 'Vainqueur désigné depuis la page admin (Preuves)',
          resolvedAt: new Date(),
        },
      });
    }

    return { ok: true };
  }
}
