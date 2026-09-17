import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { EmailConfigService } from './email-config.service';
import { EmailService } from './email.service';
import { TestEmailDto, UpdateEmailConfigDto } from './dto/email-config.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/email-config')
export class EmailConfigController {
  constructor(
    private emailConfig: EmailConfigService,
    private email: EmailService,
  ) {}

  @Get()
  get() {
    return this.emailConfig.getMasked();
  }

  @Patch()
  update(@Body() dto: UpdateEmailConfigDto) {
    return this.emailConfig.update(dto);
  }

  /// Envoi d'un email de test à l'adresse fournie — évite de devoir créer un
  /// compte pour vérifier que les identifiants SMTP saisis fonctionnent
  /// vraiment. En cas d'échec, l'erreur SMTP remonte telle quelle (503) pour
  /// que l'admin voie le motif exact (auth refusée, port bloqué…).
  @Post('test')
  async test(@Body() dto: TestEmailDto) {
    await this.email.send(
      dto.to,
      'Test SMTP Vuel',
      'Si tu lis ce message, la configuration SMTP de Vuel fonctionne : les codes OTP pourront être envoyés par email.',
    );
    const configured = await this.email.isConfigured();
    return {
      sent: configured,
      message: configured
        ? `Email de test envoyé à ${dto.to}`
        : 'SMTP non configuré — le message a seulement été écrit dans les logs du serveur',
    };
  }
}
