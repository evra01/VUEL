import { IsEmail, IsOptional, IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsPhoneNumber('CI')
  phone: string;

  @IsString()
  @MinLength(3)
  pseudo: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @MinLength(8)
  password: string;
}

export class VerifyOtpDto {
  @IsPhoneNumber('CI')
  phone: string;

  @IsString()
  code: string;
}

export class LoginDto {
  @IsPhoneNumber('CI')
  phone: string;

  @IsString()
  password: string;
}

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}
