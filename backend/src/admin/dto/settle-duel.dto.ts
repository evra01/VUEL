import { IsBoolean, IsOptional, IsString } from 'class-validator';

// Même forme que ResolveDisputeDto (cf. disputes/dto/disputes.dto.ts), mais
// sans `resolution` obligatoire ni `sanctionUserId` — ce contrôleur sert à
// valider RAPIDEMENT n'importe quelle preuve depuis la page admin (comme les
// boutons Telegram), pas seulement les duels déjà escaladés en litige.
export class SettleDuelDto {
  // Requis sauf si voidMatch est true.
  @IsString()
  @IsOptional()
  winnerId?: string;

  // Annule le match au lieu de désigner un gagnant — les deux joueurs
  // récupèrent leur mise sans commission (cf. EscrowService.refund).
  @IsBoolean()
  @IsOptional()
  voidMatch?: boolean;
}
