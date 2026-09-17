import { IsIn, IsInt, IsOptional, IsString, Length, Min, ValidateIf } from 'class-validator';

export class CreateDuelDto {
  @IsIn(['EFOOTBALL', 'CODM', 'LUDO'])
  game: 'EFOOTBALL' | 'CODM' | 'LUDO';

  @IsString()
  mode: string;

  // Mise personnalisée — minimum 200 FCFA (cf. décision produit, même seuil
  // que les tournois). Le joueur choisit librement n'importe quel montant
  // au-dessus, pas seulement les paliers proposés dans l'UI.
  @IsInt()
  @Min(200)
  stakeAmount: number;

  // Renseigné par le créateur du duel — utilisé par OcrProcessor pour
  // identifier son équipe sur la capture d'écran de fin de match.
  // UNIQUEMENT pertinent pour EFOOTBALL : c'est le seul jeu où l'écran de fin
  // de match affiche un nom de club (cf. TEAM_SCORE_PATTERN dans
  // OcrProcessor) — CODM/LUDO n'en ont pas, donc ce champ était forcé à tort
  // pour ces deux jeux (bug corrigé ici).
  @ValidateIf((o) => o.game === 'EFOOTBALL')
  @IsString()
  @Length(2, 40)
  playerATeam?: string;
}

export class JoinDuelDto {
  // Même règle que playerATeam (cf. CreateDuelDto ci-dessus) — obligatoire
  // uniquement pour rejoindre un duel EFOOTBALL. Le jeu du duel n'étant pas
  // dans ce payload (il vient du duel existant, pas de ce qu'envoie le second
  // joueur), la validation conditionnelle est faite dans DuelsService.join.
  @IsOptional()
  @IsString()
  @Length(2, 40)
  playerBTeam?: string;
}
