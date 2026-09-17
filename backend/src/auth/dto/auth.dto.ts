import { IsEmail, IsPhoneNumber, IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsPhoneNumber('CI')
  phone: string;

  @IsString()
  @MinLength(3)
  pseudo: string;

  // Obligatoire : l'email est le second canal d'envoi du code OTP, il doit donc
  // toujours être présent pour que l'inscription reste possible quand le SMS
  // n'arrive pas (opérateur qui filtre, numéro invalide…).
  @IsEmail({}, { message: 'Adresse email invalide' })
  email: string;

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
