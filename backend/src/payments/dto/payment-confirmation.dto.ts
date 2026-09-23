import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

// Envoyé par vuel_wave_monitor.py à chaque cycle (~30s) sur
// POST /webhooks/payment-confirmation/heartbeat — permet au back-office de
// savoir si le monitor tourne encore et où en est la session Wave, sans
// attendre qu'un dépôt reste bloqué pour s'en apercevoir.
export class WaveMonitorHeartbeatDto {
  @IsBoolean()
  waveSessionActive: boolean;

  @IsDateString()
  @IsOptional()
  waveExpiresAt?: string;

  // Dépôts validés automatiquement lors de CE cycle (pas le cumul) — le
  // cumul (totalValidated) est incrémenté côté serveur à partir de cette
  // valeur, pour rester correct même si le monitor redémarre et perd son
  // propre compteur local.
  @IsInt()
  @Min(0)
  lastCycleValidated: number;

  @IsString()
  @IsOptional()
  lastError?: string;
}

export class PaymentConfirmationDto {
  // Doit correspondre à Transaction.id (renvoyé par POST /wallet/deposit dans
  // client_reference lors de la création du lien Wave — ton workflow le récupère
  // depuis le webhook Wave et nous le renvoie ici une fois vérifié).
  @IsString()
  transactionId: string;

  @IsIn(['SUCCESS', 'FAILED'])
  status: 'SUCCESS' | 'FAILED';

  // Optionnel : ID de session/transaction côté Wave, pour traçabilité.
  @IsString()
  @IsOptional()
  externalRef?: string;
}
