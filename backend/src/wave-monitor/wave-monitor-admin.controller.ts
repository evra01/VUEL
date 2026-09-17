import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { PrismaService } from '../common/prisma.service';
import { PaymentConfigService } from '../payments/payment-config.service';
import { SubmitOtpDto, UpdateWaveMonitorConfigDto } from './dto/wave-monitor-config.dto';
import { WaveSessionService } from './wave-session.service';

// Même garde que le reste du back-office (cf. admin.controller.ts) — ces
// identifiants (PIN Wave Business) sont sensibles, réservés à ADMIN.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('admin/wave-monitor')
export class WaveMonitorAdminController {
  constructor(
    private prisma: PrismaService,
    private paymentConfig: PaymentConfigService,
    private waveSession: WaveSessionService,
  ) {}

  // Écran "Wave Monitor" du back-office : active/désactive la validation
  // automatique + configure les identifiants du compte Wave Business.
  @Get('status')
  status() {
    return this.waveSession.getStatus();
  }

  @Post('config')
  async updateConfig(@Body() dto: UpdateWaveMonitorConfigDto) {
    await this.paymentConfig.get(); // s'assure que la ligne "singleton" existe avant l'update
    await this.prisma.paymentConfig.update({
      where: { id: 'singleton' },
      data: {
        ...(dto.enabled !== undefined ? { waveMonitorEnabled: dto.enabled } : {}),
        ...(dto.businessPhone !== undefined ? { waveBusinessPhone: dto.businessPhone } : {}),
        ...(dto.businessPin !== undefined ? { waveBusinessPin: dto.businessPin } : {}),
        ...(dto.deviceId !== undefined ? { waveBusinessDeviceId: dto.deviceId } : {}),
      },
    });
    return this.waveSession.getStatus();
  }

  // Étape 1 : déclenche l'envoi du SMS OTP au numéro Wave Business configuré.
  @Post('login')
  login() {
    return this.waveSession.startLogin();
  }

  // Étape 2 : soumet le code reçu par SMS → ouvre la session (cf.
  // WaveMonitorService qui utilisera cette session pour vérifier les
  // paiements toutes les 30s une fois ouverte).
  @Post('otp')
  otp(@Body() dto: SubmitOtpDto) {
    return this.waveSession.submitOtp(dto.otp);
  }
}
