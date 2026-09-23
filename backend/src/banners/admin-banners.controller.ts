import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../common/prisma.service';
import { TelegramNotifierService } from '../notifications/telegram-notifier.service';
import { CreateBannerDto, UpdateBannerDto } from './dto/banners.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/banners')
export class AdminBannersController {
  constructor(
    private prisma: PrismaService,
    private telegram: TelegramNotifierService,
  ) {}

  // Toutes les bannières (actives ET désactivées) pour la page de gestion —
  // contrairement à BannersController.list (app mobile) qui ne renvoie que
  // les actives.
  @Get()
  listAll() {
    return this.prisma.banner.findMany({ orderBy: { order: 'asc' } });
  }

  // Relaie l'image vers Telegram (canal dédié TELEGRAM_BANNERS_CHAT_ID si
  // configuré, sinon le même canal que les preuves de score) exactement
  // comme CapturesService.submitProof, puis ne garde que la référence
  // (telegramFileId) — jamais l'image elle-même (cf. schema.prisma).
  @Post()
  @UseInterceptors(FileInterceptor('file'))
  async create(@UploadedFile() file: Express.Multer.File, @Body() dto: CreateBannerDto) {
    if (!file) throw new BadRequestException('Image requise');

    const result = await this.telegram.sendCapturePhoto(
      file.buffer,
      `🖼️ Nouvelle bannière Vuel${dto.linkUrl ? ' — lien : ' + dto.linkUrl : ' (sans lien)'}`,
      process.env.TELEGRAM_BANNERS_CHAT_ID,
    );
    if (!result.ok) {
      throw new ServiceUnavailableException(
        result.reason === 'not_configured'
          ? "Telegram n'est pas configuré (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ou TELEGRAM_BANNERS_CHAT_ID) — voir .env.example."
          : "Échec de l'envoi de l'image vers Telegram, réessaie.",
      );
    }

    const maxOrder = await this.prisma.banner.aggregate({ _max: { order: true } });
    return this.prisma.banner.create({
      data: {
        telegramFileId: result.fileId!,
        telegramMessageId: result.messageId,
        linkUrl: dto.linkUrl,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });
  }

  // Activer/désactiver, changer le lien ou l'ordre — sans re-uploader
  // l'image (elle ne bouge jamais une fois envoyée à Telegram).
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.prisma.banner.update({ where: { id }, data: dto });
  }

  // Ne supprime que l'enregistrement côté Vuel — le message reste sur
  // Telegram (on ne gère pas la suppression de messages Telegram, ça n'a pas
  // d'impact : plus personne n'y accède une fois le Banner supprimé ici).
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.banner.delete({ where: { id } });
  }
}
