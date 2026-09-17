import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { SmsConfigService } from './sms-config.service';

/// Envoi de SMS via l'API REST Twilio (https://www.twilio.com/docs/sms/send-messages).
/// Pas de SDK ajouté — un simple appel HTTP avec Basic Auth suffit et évite une
/// dépendance lourde pour un seul endpoint.
///
/// MODE DEV : si Twilio n'est pas configuré, le message est simplement affiché dans le
/// terminal (au lieu d'échouer) — pratique pour tester l'inscription/OTP en local sans
/// avoir à créer un compte Twilio. À retirer (ou restreindre à NODE_ENV !== 'production')
/// avant la mise en prod, sinon n'importe qui peut lire l'OTP dans les logs serveur.
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private smsConfig: SmsConfigService) {}

  async send(toPhone: string, message: string): Promise<void> {
    const config = await this.smsConfig.get();
    const configured = !!(config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber);

    if (!configured) {
      this.logger.warn(
        `[SMS non configuré — affiché ici pour le dev] → ${toPhone} : ${message}`,
      );
      return;
    }

    const url = `https://api.twilio.com/2010-04-01/Accounts/${config.twilioAccountSid}/Messages.json`;
    const body = new URLSearchParams({
      To: toPhone,
      From: config.twilioFromNumber!,
      Body: message,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new ServiceUnavailableException(`Échec d'envoi du SMS via Twilio: ${errorBody}`);
    }
  }
}
