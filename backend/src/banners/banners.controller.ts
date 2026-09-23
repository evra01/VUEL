import { Response } from 'express';
import { Controller, Get, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { TelegramNotifierService } from '../notifications/telegram-notifier.service';

/// Consulté par l'app mobile (carrousel en haut de l'écran d'accueil, cf.
/// AccueilTab côté Flutter) — n'importe quel utilisateur connecté peut lire
/// les bannières actives, contrairement à AdminBannersController qui gère
/// l'upload/suppression (réservé aux admins).
@UseGuards(JwtAuthGuard)
@Controller('banners')
export class BannersController {
  constructor(
    private prisma: PrismaService,
    private telegram: TelegramNotifierService,
  ) {}

  @Get()
  list() {
    return this.prisma.banner.findMany({
      where: { active: true },
      orderBy: { order: 'asc' },
      select: { id: true, linkUrl: true, order: true },
    });
  }

  // Retélécharge l'image depuis Telegram à la demande — jamais stockée sur ce
  // serveur (voir commentaire du modèle Banner dans schema.prisma). Même
  // mécanisme que AdminProofsController.getImage.
  @Get(':id/image')
  async getImage(@Param('id') id: string, @Res() res: Response) {
    const banner = await this.prisma.banner.findUniqueOrThrow({ where: { id } });
    const image = await this.telegram.getProofImage(banner.telegramFileId);
    if (!image) {
      throw new NotFoundException("Impossible de récupérer cette bannière depuis Telegram — le fichier a peut-être expiré.");
    }
    res.set('Content-Type', image.contentType);
    // Une bannière déjà publiée ne change jamais d'image (on en crée une
    // nouvelle plutôt que d'éditer l'existante) — cache long côté client pour
    // éviter de la retélécharger depuis Telegram à chaque ouverture de l'app.
    res.set('Cache-Control', 'private, max-age=604800');
    res.send(image.buffer);
  }
}
