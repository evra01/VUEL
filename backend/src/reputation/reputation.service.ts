import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const BAN_THRESHOLD = 0; // score de réputation en dessous duquel le compte est suspendu
const DEFAULT_SANCTION_POINTS = 20;

/// Sanctions et bannissements pour fausse déclaration de score (cf. cahier des charges 3.5).
@Injectable()
export class ReputationService {
  private readonly logger = new Logger(ReputationService.name);

  constructor(private prisma: PrismaService) {}

  async applySanction(userId: string, reason: string, points: number = DEFAULT_SANCTION_POINTS) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { reputationScore: { decrement: points } },
    });

    if (user.reputationScore <= BAN_THRESHOLD) {
      // TODO: bannissement réel — bloquer login/matchmaking, pas seulement journaliser
      this.logger.warn(`Utilisateur ${userId} sous le seuil de réputation (${user.reputationScore}) — à bannir`);
    }

    return user;
  }
}
