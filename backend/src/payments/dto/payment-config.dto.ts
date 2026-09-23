import { IsOptional, IsString, IsUrl } from 'class-validator';

export class UpdatePaymentConfigDto {
  // Lien Wave fixe (ex: https://pay.wave.com/m/M_xxx/c/ci/) utilisé pour le flux
  // de dépôt actuel (lien fixe + validation manuelle Telegram). C'est le seul
  // champ nécessaire pour activer les dépôts avec ce mode — pas de clé API.
  @IsUrl({ require_tld: false })
  @IsOptional()
  waveDepositLink?: string;

  // Champs ci-dessous : Wave Checkout via API (clé API Wave Business + webhook
  // auto), gardés pour réactivation future mais non utilisés par le flux de
  // dépôt actuel (cf. WalletService.deposit).
  @IsString()
  @IsOptional()
  waveApiKey?: string;

  // Secret que ton workflow externe doit envoyer dans le header X-Webhook-Secret
  // pour confirmer un paiement (cf. POST /webhooks/payment-confirmation).
  @IsString()
  @IsOptional()
  webhookSharedSecret?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  waveApiBaseUrl?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  successUrl?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  errorUrl?: string;
}
