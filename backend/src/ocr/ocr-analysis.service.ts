import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createWorker, Worker as TesseractWorker } from 'tesseract.js';
import { PrismaService } from '../common/prisma.service';
import { teamsMatch } from '../common/team-name.util';
import { DuelsService } from '../duels/duels.service';
import { TournamentsService } from '../tournaments/tournaments.service';
import { TelegramNotifierService } from '../notifications/telegram-notifier.service';

// Seuil de confiance en dessous duquel on préfère escalader vers un litige
// plutôt que de créditer automatiquement (cf. cahier des charges, module arbitrage).
const CONFIDENCE_THRESHOLD = 0.85;

// Score au format réel des écrans de fin de match eFootball :
// "ÉquipeA 10 [icône] 11 ÉquipeB" — les deux nombres sont entourés par les
// noms d'équipe, séparés par une icône graphique (pas un caractère texte),
// donc potentiellement 0 à quelques caractères parasites entre les deux
// scores selon ce que Tesseract réussit (ou non) à lire de cette icône.
// Capture : [1]=équipe1 [2]=score1 [3]=score2 [4]=équipe2.
// UNIQUEMENT valable pour EFOOTBALL : CODM et LUDO n'affichent aucun nom
// d'équipe sur leur écran de résultat, donc ce pattern ne matche JAMAIS pour
// ces deux jeux (c'était le bug — confiance à 0 systématiquement, cf.
// SCORE_ONLY_PATTERN plus bas et son utilisation dans analyzeImage).
const TEAM_SCORE_PATTERN =
  /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]{1,30}?)\s+(\d{1,2})\D{0,4}(\d{1,2})\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ' ]{1,30})/;

// Repli pour CODM/LUDO (pas de nom d'équipe exploitable — cf. ci-dessus), et
// pour EFOOTBALL quand le nom du club n'a pas été lu correctement par
// Tesseract : on se contente des deux scores, séparés par un tiret/deux-points
// explicite (évite de capter n'importe quelle paire de nombres à l'écran,
// ex : un chrono ou un niveau). Sans nom d'équipe, une preuve seule ne peut
// pas déterminer le gagnant (cf. determineWinnerFromSingleProof) — il faut
// alors deux preuves croisées (cf. determineWinner, heuristique de position).
// À valider/ajuster contre de vraies captures CODM/LUDO si le format exact
// diffère (icône au lieu du tiret, etc.).
const SCORE_ONLY_PATTERN = /(\d{1,2})\s*[-–:]\s*(\d{1,2})/;

interface ParsedMatchLine {
  team1: string;
  team2: string;
  score1: number;
  score2: number;
}

/// Toute la logique d'analyse OCR + règlement de duel, extraite de l'ancien
/// OcrProcessor pour être utilisable AVEC ou SANS BullMQ/Redis (cf.
/// OcrQueueService et OcrProcessor, qui appellent tous les deux
/// `handleProof` ci-dessous). OCR via Tesseract.js — moteur open-source qui
/// tourne directement sur ce serveur, sans clé API ni compte externe
/// (contrairement à Google Cloud Vision). Le worker est initialisé une seule
/// fois (pas à chaque job : le chargement du modèle de langue est coûteux).
@Injectable()
export class OcrAnalysisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OcrAnalysisService.name);
  private ocrWorker: TesseractWorker | null = null;
  private workerReady: Promise<void> | null = null;

  constructor(
    private prisma: PrismaService,
    private duelsService: DuelsService,
    private tournamentsService: TournamentsService,
    private telegram: TelegramNotifierService,
  ) {}

  onModuleInit() {
    // Lazy + mémorisé : le premier job attend l'init, les suivants réutilisent
    // directement le worker déjà prêt.
    this.workerReady = this.initWorker();
  }

  async onModuleDestroy() {
    await this.ocrWorker?.terminate();
  }

  private async initWorker() {
    try {
      this.ocrWorker = await createWorker('eng');
      this.logger.log('Worker Tesseract.js prêt (OCR local, sans clé API).');
    } catch (err) {
      this.logger.error('Échec d\'initialisation de Tesseract.js — OCR indisponible:', err);
    }
  }

  async handleProof(data: { proofId: string; imageBase64: string }) {
    const proof = await this.prisma.screenshotProof.findUniqueOrThrow({
      where: { id: data.proofId },
      // playerA/playerB inclus (pseudo seulement) pour pouvoir libeller les
      // boutons de décision Telegram envoyés quand l'OCR échoue à trancher
      // (cf. sendDecisionButtons plus bas) — sans ça on ne pourrait afficher
      // que "joueur A" / "joueur B" au lieu du vrai pseudo.
      include: { duel: { include: { playerA: { select: { pseudo: true } }, playerB: { select: { pseudo: true } } } } },
    });

    // Un duel déjà tranché (par ce job OCR sur une preuve précédente, ou par
    // un admin via /gagnant sur Telegram pendant qu'on analysait celle-ci)
    // n'a plus besoin d'être réévalué — évite un double règlement.
    if (proof.duel.status === 'COMPLETED' || proof.duel.status === 'CANCELLED') return;

    const analysis = await this.analyzeImage(proof.duel.game, data.imageBase64);

    await this.prisma.screenshotProof.update({
      where: { id: proof.id },
      data: {
        ocrRawResult: JSON.stringify(analysis.raw),
        ocrScoreDetected: analysis.parsed ? `${analysis.parsed.score1}-${analysis.parsed.score2}` : '',
        ocrTeamsDetected: analysis.parsed?.team1 ? `${analysis.parsed.team1} vs ${analysis.parsed.team2}` : '',
        ocrConfidence: analysis.confidence,
      },
    });

    // Une seule capture suffit : pas besoin d'attendre que l'adversaire
    // envoie la sienne (il peut très bien ne jamais le faire, surtout s'il a
    // perdu) — on tente de trancher dès CETTE preuve.
    if (analysis.confidence >= CONFIDENCE_THRESHOLD) {
      const winnerId = await this.determineWinnerFromSingleProof(proof.duel, analysis.parsed);
      if (winnerId) {
        await this.settleDuel(proof.duel, winnerId);
        await this.sendOcrRecap(proof, analysis, `✅ Duel réglé automatiquement — vainqueur : ${winnerId}.`);
        return;
      }
    }

    // Cette preuve seule n'a pas suffi (confiance trop faible, équipe non
    // reconnue, match nul, ou jeu sans nom d'équipe exploitable). Si une
    // seconde preuve est déjà arrivée pour ce duel, on tente un dernier
    // croisement (les deux captures analysées indépendamment doivent alors
    // s'accorder) avant d'ouvrir un litige.
    const allProofs = await this.prisma.screenshotProof.findMany({ where: { duelId: proof.duelId } });
    if (allProofs.length < 2) {
      // laisse une chance à une éventuelle seconde capture
      await this.sendOcrRecap(proof, analysis, '⏳ En attente de la seconde preuve avant de trancher.');
      await this.sendDecisionButtons(proof);
      return;
    }

    const [a, b] = allProofs;
    const bothConfident =
      (a.ocrConfidence ?? 0) >= CONFIDENCE_THRESHOLD && (b.ocrConfidence ?? 0) >= CONFIDENCE_THRESHOLD;
    const crossWinnerId = bothConfident ? await this.determineWinner(proof.duel, a, b) : null;

    if (crossWinnerId) {
      await this.settleDuel(proof.duel, crossWinnerId);
      await this.sendOcrRecap(
        proof,
        analysis,
        `✅ Duel réglé après croisement des deux preuves — vainqueur : ${crossWinnerId}.`,
      );
      return;
    }

    const reason = bothConfident
      ? 'Impossible de déterminer le gagnant avec certitude à partir des captures (équipes non reconnues ou match nul)'
      : "Confiance OCR insuffisante sur les captures reçues — un admin peut trancher directement sur Telegram en répondant à la capture avec /gagnant <nom de l'équipe>";

    await this.prisma.duel.update({ where: { id: proof.duelId }, data: { status: 'DISPUTED' } });
    await this.prisma.dispute.create({
      data: { duelId: proof.duelId, reportedById: proof.userId, reason },
    });
    await this.sendOcrRecap(proof, analysis, `⚠️ Litige ouvert — ${reason}`);
    await this.sendDecisionButtons(proof);
  }

  /// Envoyé chaque fois que l'OCR n'a PAS pu trancher automatiquement cette
  /// preuve (confiance insuffisante, litige ouvert, ou en attente d'une
  /// seconde capture) — permet à un admin de valider le vainqueur ou
  /// d'annuler le duel en un tap depuis Telegram, sans taper la commande
  /// texte /gagnant (cf. TelegramCommandsService.handleCallbackQuery pour le
  /// traitement du tap). Toujours en réponse au message contenant CETTE
  /// capture, pour que l'admin sache quelle photo regarder.
  private async sendDecisionButtons(proof: {
    telegramMessageId: number | null;
    duelId: string;
    duel: { playerA: { pseudo: string }; playerB: { pseudo: string } | null };
  }): Promise<void> {
    const buttons: { text: string; callbackData: string }[][] = [
      [{ text: `✅ ${proof.duel.playerA.pseudo} gagne`, callbackData: `wA:${proof.duelId}` }],
    ];
    if (proof.duel.playerB) {
      buttons[0].push({ text: `✅ ${proof.duel.playerB.pseudo} gagne`, callbackData: `wB:${proof.duelId}` });
    }
    buttons.push([{ text: '❌ Annuler le duel (remboursement)', callbackData: `void:${proof.duelId}` }]);

    await this.telegram.sendDecisionButtons(
      proof.telegramMessageId ?? undefined,
      "👆 L'OCR n'a pas pu trancher automatiquement cette capture — que décides-tu ?",
      buttons,
    );
  }

  /// Récapitulatif systématique envoyé après CHAQUE analyse OCR (quelle que
  /// soit l'issue : règlement auto, attente de seconde preuve, ou litige) —
  /// en réponse au message Telegram de la capture d'origine (cf.
  /// CapturesService.submitProof) pour rester dans le même fil de discussion.
  /// N'est jamais bloquant pour le traitement du duel (cf. TelegramNotifierService).
  private async sendOcrRecap(
    proof: { telegramMessageId: number | null },
    analysis: { parsed: ParsedMatchLine | null; confidence: number },
    resultLine: string,
  ): Promise<void> {
    const confidencePct = Math.round(analysis.confidence * 100);
    const detection = analysis.parsed
      ? analysis.parsed.team1
        ? `${analysis.parsed.team1} ${analysis.parsed.score1} - ${analysis.parsed.score2} ${analysis.parsed.team2}`
        : `${analysis.parsed.score1} - ${analysis.parsed.score2}`
      : 'aucun score/équipe reconnu';

    const recap =
      `🔎 Récapitulatif OCR\n` +
      `Détection : ${detection}\n` +
      `Confiance : ${confidencePct}%\n` +
      resultLine;

    await this.telegram.sendMessage(recap, proof.telegramMessageId ?? undefined);
  }

  /// Applique le verdict : règle le duel (paiement via escrow) ou, pour un
  /// match de bracket de tournoi, reporte le résultat au module tournois qui
  /// n'a pas d'escrow propre (cf. TournamentsService).
  private async settleDuel(
    duel: { id: string; tournamentId: string | null },
    winnerId: string,
  ): Promise<void> {
    if (duel.tournamentId) {
      await this.tournamentsService.reportMatchResult(duel.id, winnerId);
    } else {
      await this.duelsService.complete(duel.id, winnerId);
    }
  }

  /// Tente de désigner un gagnant à partir d'UNE SEULE capture — cf. handleProof().
  /// Ne s'applique qu'à EFOOTBALL, où chaque camp affiche le nom de son club
  /// sur l'écran de résultat : sans repère d'équipe fiable (CODM/LUDO n'en
  /// ont pas), une capture seule ne permet pas de savoir laquelle des deux
  /// colonnes de score appartient à quel joueur.
  private async determineWinnerFromSingleProof(
    duel: {
      id: string;
      game: string;
      playerAId: string;
      playerBId: string | null;
      playerATeam?: string | null;
      playerBTeam?: string | null;
    },
    parsed: ParsedMatchLine | null,
  ): Promise<string | null> {
    if (!parsed) return null;
    if (parsed.score1 === parsed.score2) return null; // match nul → pas de gagnant unilatéral
    if (duel.game !== 'EFOOTBALL' || !duel.playerBId) return null;

    const { playerATeam, playerBTeam } = await this.resolveTeamNames(duel);
    if (!playerATeam || !playerBTeam) return null;

    return this.resolveWinnerByTeam(parsed, duel.playerAId, playerATeam, duel.playerBId, playerBTeam);
  }

  /// Nom d'équipe déclaré pour CE duel (formulaire de création/pour rejoindre)
  /// en priorité, avec repli sur l'équipe de rêve du profil (GamingId) pour
  /// les anciens duels créés avant l'ajout de ce champ.
  private async resolveTeamNames(duel: {
    playerAId: string;
    playerBId: string | null;
    playerATeam?: string | null;
    playerBTeam?: string | null;
  }): Promise<{ playerATeam?: string; playerBTeam?: string }> {
    let playerATeam = duel.playerATeam ?? undefined;
    let playerBTeam = duel.playerBTeam ?? undefined;
    if ((!playerATeam || !playerBTeam) && duel.playerBId) {
      const [gamingA, gamingB] = await Promise.all([
        this.prisma.gamingId.findUnique({ where: { userId_game: { userId: duel.playerAId, game: 'EFOOTBALL' } } }),
        this.prisma.gamingId.findUnique({ where: { userId_game: { userId: duel.playerBId, game: 'EFOOTBALL' } } }),
      ]);
      playerATeam = playerATeam ?? gamingA?.favoriteTeam ?? undefined;
      playerBTeam = playerBTeam ?? gamingB?.favoriteTeam ?? undefined;
    }
    return { playerATeam, playerBTeam };
  }

  /// Détermine le gagnant en croisant les équipes détectées sur CHAQUE
  /// capture avec le nom d'équipe de chaque joueur (cf. resolveTeamNames) —
  /// dernier recours quand une seule capture n'a pas suffi (cf. handleProof()).
  /// Si l'un des deux joueurs n'a aucune équipe connue (ou jeu non EFOOTBALL,
  /// ou nom détecté ne correspondant à aucune équipe connue), on retombe sur
  /// l'ancienne heuristique de position gauche/droite en dernier recours.
  private async determineWinner(
    duel: {
      id: string;
      game: string;
      playerAId: string;
      playerBId: string | null;
      playerATeam?: string | null;
      playerBTeam?: string | null;
    },
    proofA: { userId: string; ocrScoreDetected: string | null; ocrTeamsDetected: string | null },
    proofB: { userId: string; ocrScoreDetected: string | null; ocrTeamsDetected: string | null },
  ): Promise<string | null> {
    const parsedA = this.reconstructParsed(proofA.ocrScoreDetected, proofA.ocrTeamsDetected);
    const parsedB = this.reconstructParsed(proofB.ocrScoreDetected, proofB.ocrTeamsDetected);
    if (!parsedA || !parsedB) return null;
    if (parsedA.score1 === parsedA.score2) return null; // match nul détecté → arbitrage manuel

    if (duel.game === 'EFOOTBALL' && duel.playerBId) {
      const { playerATeam, playerBTeam } = await this.resolveTeamNames(duel);

      if (playerATeam && playerBTeam) {
        const winnerFromA = this.resolveWinnerByTeam(
          parsedA,
          duel.playerAId,
          playerATeam,
          duel.playerBId,
          playerBTeam,
        );
        const winnerFromB = this.resolveWinnerByTeam(
          parsedB,
          duel.playerAId,
          playerATeam,
          duel.playerBId,
          playerBTeam,
        );
        // On exige que les deux captures, analysées indépendamment,
        // s'accordent sur le même gagnant — c'est ça, la vraie cohérence
        // (pas une comparaison de chaînes brutes).
        if (winnerFromA && winnerFromA === winnerFromB) return winnerFromA;
        return null; // équipes non reconnues ou désaccord → arbitrage manuel
      }
    }

    // Repli : aucune équipe de rêve renseignée (ou jeu non concerné) — on
    // suppose que chaque joueur apparaît à gauche de son propre écran de
    // résultat. Convention non garantie, gardée uniquement en dernier
    // recours pour ne pas bloquer les joueurs qui n'ont pas encore renseigné
    // leur équipe.
    if (parsedA.score1 === parsedB.score2 && parsedA.score2 === parsedB.score1) {
      return parsedA.score1 > parsedA.score2 ? proofA.userId : proofB.userId;
    }
    return null;
  }

  private resolveWinnerByTeam(
    parsed: ParsedMatchLine,
    playerAId: string,
    playerATeam: string,
    playerBId: string,
    playerBTeam: string,
  ): string | null {
    const aIsTeam1 = this.teamsMatch(parsed.team1, playerATeam);
    const aIsTeam2 = this.teamsMatch(parsed.team2, playerATeam);
    const bIsTeam1 = this.teamsMatch(parsed.team1, playerBTeam);
    const bIsTeam2 = this.teamsMatch(parsed.team2, playerBTeam);

    if (aIsTeam1 && bIsTeam2 && !aIsTeam2 && !bIsTeam1) {
      if (parsed.score1 === parsed.score2) return null;
      return parsed.score1 > parsed.score2 ? playerAId : playerBId;
    }
    if (aIsTeam2 && bIsTeam1 && !aIsTeam1 && !bIsTeam2) {
      if (parsed.score1 === parsed.score2) return null;
      return parsed.score2 > parsed.score1 ? playerAId : playerBId;
    }
    return null; // correspondance ambiguë ou absente
  }

  /// Comparaison tolérante aux accents/casse/espaces et aux formulations
  /// partielles (ex: le club peut apparaître tronqué ou avec un tag de clan
  /// devant/derrière sur la capture) — voir team-name.util.ts (partagé avec
  /// l'arbitrage manuel sur Telegram, pour une règle de correspondance
  /// identique entre les deux canaux de vérification).
  private teamsMatch(detected: string, registered: string): boolean {
    return teamsMatch(detected, registered);
  }

  private reconstructParsed(scoreDetected: string | null, teamsDetected: string | null): ParsedMatchLine | null {
    if (!scoreDetected) return null;
    const scoreMatch = scoreDetected.match(/^(\d{1,2})-(\d{1,2})$/);
    if (!scoreMatch) return null;

    // "Team1 vs Team2" — le séparateur " vs " est celui utilisé par
    // analyzeImage pour construire ocrTeamsDetected, donc fiable à re-parser.
    const teamsMatch = teamsDetected?.match(/^(.*) vs (.*)$/);

    return {
      team1: teamsMatch?.[1]?.trim() ?? '',
      team2: teamsMatch?.[2]?.trim() ?? '',
      score1: parseInt(scoreMatch[1], 10),
      score2: parseInt(scoreMatch[2], 10),
    };
  }

  private async analyzeImage(
    game: string,
    imageBase64: string,
  ): Promise<{ raw: unknown; parsed: ParsedMatchLine | null; confidence: number }> {
    await this.workerReady;
    if (!this.ocrWorker) {
      this.logger.warn('Worker Tesseract.js indisponible — le duel sera mis en litige pour arbitrage manuel.');
      return { raw: null, parsed: null, confidence: 0 };
    }

    try {
      const { data } = await this.ocrWorker.recognize(`data:image/png;base64,${imageBase64}`);
      const fullText = data.text ?? '';

      // EFOOTBALL seulement : tente d'abord le pattern équipe+score, qui
      // permet un règlement dès la première preuve (cf.
      // determineWinnerFromSingleProof). CODM/LUDO n'ont pas de nom d'équipe
      // exploitable (cf. TEAM_SCORE_PATTERN) donc on passe directement au
      // pattern score-seul, sans quoi la confiance restait à 0 à chaque fois.
      const teamMatch = game === 'EFOOTBALL' ? fullText.match(TEAM_SCORE_PATTERN) : null;

      let parsed: ParsedMatchLine | null = null;
      let scoreWords: string[] = [];

      if (teamMatch) {
        parsed = {
          team1: teamMatch[1].trim(),
          score1: parseInt(teamMatch[2], 10),
          score2: parseInt(teamMatch[3], 10),
          team2: teamMatch[4].trim(),
        };
        scoreWords = [String(parsed.score1), String(parsed.score2)];
      } else {
        const scoreMatch = fullText.match(SCORE_ONLY_PATTERN);
        if (scoreMatch) {
          parsed = {
            team1: '',
            team2: '',
            score1: parseInt(scoreMatch[1], 10),
            score2: parseInt(scoreMatch[2], 10),
          };
          scoreWords = [String(parsed.score1), String(parsed.score2)];
        }
      }

      if (!parsed) {
        return { raw: { text: fullText }, parsed: null, confidence: 0 };
      }

      // Tesseract donne une confiance par mot (0-100) — on prend celle des
      // mots qui composent les deux scores détectés, sinon la confiance
      // globale de la page en repli.
      const words = (data as any).words as Array<{ text: string; confidence: number }> | undefined;
      const relevant = words?.filter((w) => scoreWords.includes(w.text.trim())) ?? [];
      const confidencePct = relevant.length > 0
        ? relevant.reduce((sum, w) => sum + w.confidence, 0) / relevant.length
        : data.confidence ?? 0;

      return { raw: { text: fullText }, parsed, confidence: confidencePct / 100 };
    } catch (err) {
      this.logger.error('Erreur pendant la reconnaissance Tesseract.js:', err);
      return { raw: null, parsed: null, confidence: 0 };
    }
  }
}
