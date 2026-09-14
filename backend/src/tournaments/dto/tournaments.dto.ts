import { IsIn, IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export const MIN_TOURNAMENT_STAKE = 200; // FCFA — décision produit

export class CreateTournamentDto {
  @IsString()
  @MinLength(3)
  name: string;

  @IsIn(['EFOOTBALL', 'CODM', 'LUDO'])
  game: 'EFOOTBALL' | 'CODM' | 'LUDO';

  @IsInt()
  @Min(MIN_TOURNAMENT_STAKE)
  stakeAmount: number;

  @IsInt()
  @Min(4) // un bracket a minima 4 participants pour avoir un sens (sinon c'est juste un duel)
  @Max(64)
  maxParticipants: number;
}
