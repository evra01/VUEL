import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateWaveMonitorConfigDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  // Numéro du compte Wave Business (celui qui reçoit les dépôts) — même
  // format que WAVE_BUSINESS_PHONE côté outil standalone.
  @IsString()
  @IsOptional()
  businessPhone?: string;

  // PIN Wave Business — jamais renvoyé en clair par GET /admin/wave-monitor/status.
  @IsString()
  @IsOptional()
  businessPin?: string;

  // Identifiant d'appareil arbitraire (UUID conseillé) — sert à Wave à
  // reconnaître l'appareil "de confiance" entre deux connexions.
  @IsString()
  @IsOptional()
  deviceId?: string;
}

export class SubmitOtpDto {
  @IsString()
  @MinLength(4)
  otp: string;
}
