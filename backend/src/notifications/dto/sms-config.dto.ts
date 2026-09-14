import { IsOptional, IsString } from 'class-validator';

export class UpdateSmsConfigDto {
  @IsString()
  @IsOptional()
  twilioAccountSid?: string;

  @IsString()
  @IsOptional()
  twilioAuthToken?: string;

  @IsString()
  @IsOptional()
  twilioFromNumber?: string;
}
