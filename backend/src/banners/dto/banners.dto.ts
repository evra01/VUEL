import { IsBoolean, IsInt, IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateBannerDto {
  @IsUrl()
  @IsOptional()
  linkUrl?: string;
}

export class UpdateBannerDto {
  @IsUrl()
  @IsOptional()
  linkUrl?: string;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsInt()
  @IsOptional()
  order?: number;
}
