import { IsIn, IsInt, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class SetUserRoleDto {
  @IsIn(['PLAYER', 'ARBITER', 'ADMIN'])
  role: 'PLAYER' | 'ARBITER' | 'ADMIN';
}

export class AdjustWalletDto {
  @IsInt()
  @IsPositive()
  amount: number;

  @IsIn(['CREDIT', 'DEBIT'])
  direction: 'CREDIT' | 'DEBIT';
}

// Utilisé par POST /admin/withdrawals/:id/other — statut "Autre" pour un
// retrait qui ne rentre ni dans "Effectué" ni dans "Annulé" (cf. cahier des
// charges statuts retrait). La note est libre, à l'appréciation de l'admin
// (ex: "en attente de coordonnées correctes", "viré hors app, à vérifier").
export class MarkWithdrawalOtherDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
