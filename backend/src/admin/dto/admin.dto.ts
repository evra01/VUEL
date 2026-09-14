import { IsIn, IsInt, IsPositive } from 'class-validator';

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
