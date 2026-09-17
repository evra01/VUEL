import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class CreateDisputeDto {
  @IsString()
  duelId: string;

  @IsString()
  reason: string;
}

export class ResolveDisputeDto {
  // Requis sauf si voidMatch est true (dans ce cas, aucun gagnant : match annulé,
  // les deux joueurs sont remboursés).
  @IsString()
  @IsOptional()
  winnerId?: string;

  // Annule le match au lieu de désigner un gagnant — les deux joueurs récupèrent
  // leur mise sans commission (cf. EscrowService.refund). Utile quand le litige
  // n'est pas tranchable (ex: preuves insuffisantes des deux côtés, déconnexion
  // avant la fin, accord mutuel pour annuler).
  @IsBoolean()
  @IsOptional()
  voidMatch?: boolean;

  @IsString()
  resolution: string;

  // Si renseigné, applique une sanction de réputation à ce joueur (ex: fausse déclaration de score)
  @IsString()
  @IsOptional()
  sanctionUserId?: string;
}
