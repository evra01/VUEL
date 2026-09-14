import { IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';

export class DepositDto {
  @IsInt()
  @Min(100)
  amount: number;

  // Un seul provider actif pour l'instant : lien Wave fixe + validation manuelle
  // (cf. décision produit — comme Espace Parent, plutôt que l'API Checkout Wave
  // Business). Champ gardé optionnel/figé pour ne pas casser le contrat API
  // quand d'autres providers seront rebranchés (Orange Money, MTN MoMo, carte).
  @IsIn(['wave'])
  @IsOptional()
  provider?: 'wave' = 'wave';

  // Numéro que le joueur va utiliser pour payer sur Wave — indispensable pour
  // que l'admin retrouve le paiement reçu sur le compte Wave Business avant
  // de valider manuellement le dépôt (cf. WalletService.deposit).
  @Matches(/^\+?\d{8,15}$/, { message: 'Merci d’indiquer un numéro de téléphone valide.' })
  phoneNumber: string;
}

export class WithdrawDto {
  @IsInt()
  @Min(500)
  amount: number;

  // Un seul moyen de retrait actif pour l'instant, comme pour le dépôt (cf.
  // DepositDto ci-dessus) — champ gardé optionnel/figé plutôt que supprimé
  // pour ne pas casser le contrat API si d'autres moyens sont rebranchés
  // plus tard (Orange Money, MTN MoMo).
  @IsIn(['wave'])
  @IsOptional()
  provider?: 'wave' = 'wave';
}
