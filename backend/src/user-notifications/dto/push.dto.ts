import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class WebPushSubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  // Reçu tel quel depuis `PushSubscription.toJSON().keys` côté navigateur
  // (voir pwa/index.html subscribeToPush()) — pas de validation de format
  // plus stricte, ce sont des clés cryptographiques encodées en base64url.
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class WebPushUnsubscribeDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsIn(['ANDROID', 'IOS'])
  @IsOptional()
  platform?: 'ANDROID' | 'IOS' = 'ANDROID';
}

export class UnregisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  token: string;
}
