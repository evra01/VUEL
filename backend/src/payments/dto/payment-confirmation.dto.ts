import { IsIn, IsOptional, IsString } from 'class-validator';

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
