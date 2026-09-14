import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { UpdateDeviceInfoDto, AddGamingIdDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  getProfile(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { gamingIds: true, wallet: true },
    });
  }

  updateDeviceInfo(userId: string, dto: UpdateDeviceInfoDto) {
    return this.prisma.user.update({ where: { id: userId }, data: dto });
  }

  addGamingId(userId: string, dto: AddGamingIdDto) {
    return this.prisma.gamingId.upsert({
      where: { userId_game: { userId, game: dto.game } },
      create: { userId, game: dto.game, gamePseudo: dto.gamePseudo, favoriteTeam: dto.favoriteTeam },
      update: { gamePseudo: dto.gamePseudo, favoriteTeam: dto.favoriteTeam, verified: false },
    });
  }

  // Stocke l'ID de l'icône choisie parmi la liste fixe AVATAR_ICON_IDS — aucun fichier,
  // aucun upload : l'icône elle-même vit côté app (assets), seul l'ID est persisté.
  async setAvatar(userId: string, avatarId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { avatarId } });
  }
}
