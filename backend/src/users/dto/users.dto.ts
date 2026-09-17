import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateDeviceInfoDto {
  @IsIn(['android', 'ios'])
  @IsOptional()
  deviceOs?: string;

  @IsString()
  @IsOptional()
  deviceBrand?: string;

  @IsString()
  @IsOptional()
  deviceModel?: string;
}

export class AddGamingIdDto {
  @IsIn(['EFOOTBALL', 'CODM', 'LUDO'])
  game: 'EFOOTBALL' | 'CODM' | 'LUDO';

  @IsString()
  gamePseudo: string;

  // Pertinent seulement pour EFOOTBALL — le nom du club utilisé en jeu, qui
  // sert ensuite à faire correspondre automatiquement le score détecté par
  // OCR (voir OcrProcessor) au bon joueur, sans avoir à deviner une
  // convention gauche/droite ambiguë sur la capture d'écran.
  @IsString()
  @IsOptional()
  favoriteTeam?: string;
}

// Liste fixe d'icônes fournies par l'app — doit rester synchronisée avec
// AppAvatarIcons côté mobile (lib/core/assets/app_avatar_icons.dart).
export const AVATAR_ICON_IDS = [
  'flame', 'trophy', 'bolt', 'target', 'dice', 'shield', 'star', 'controller',
] as const;

export class SetAvatarDto {
  @IsIn(AVATAR_ICON_IDS)
  avatarId: (typeof AVATAR_ICON_IDS)[number];
}
