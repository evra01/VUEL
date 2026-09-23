import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { EmailConfigService } from './email-config.service';

/// Envoi d'emails via un serveur SMTP quelconque (Gmail, Brevo, Mailgun, OVH,
/// serveur maison…), configuré depuis la page admin — exactement comme la config
/// Twilio pour les SMS.
///
/// MODE DEV : si le SMTP n'est pas configuré, le message est affiché dans les logs
/// au lieu d'échouer, pour pouvoir tester l'inscription en local (même compromis
/// que SmsService — à restreindre à NODE_ENV !== 'production' avant la mise en prod).
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  // On garde le transporteur en cache : ouvrir une connexion SMTP à chaque OTP
  // serait lent. La clé est une empreinte de la config, donc une modification
  // depuis la page admin reconstruit automatiquement le transporteur.
  private cachedTransport?: { key: string; transport: Transporter };

  constructor(private emailConfig: EmailConfigService) {}

  /// true si un envoi réel est possible (SMTP renseigné en base).
  async isConfigured(): Promise<boolean> {
    const config = await this.emailConfig.get();
    return this.emailConfig.isConfigured(config);
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    const config = await this.emailConfig.get();

    if (!this.emailConfig.isConfigured(config)) {
      this.logger.warn(`[SMTP non configuré — affiché ici pour le dev] → ${to} | ${subject} : ${text}`);
      return;
    }

    const port = config.smtpPort ?? (config.smtpSecure ? 465 : 587);
    const key = [config.smtpHost, port, config.smtpSecure, config.smtpUser, config.smtpPassword].join('|');

    if (this.cachedTransport?.key !== key) {
      this.cachedTransport?.transport.close();
      this.cachedTransport = {
        key,
        transport: nodemailer.createTransport({
          host: config.smtpHost!,
          port,
          secure: config.smtpSecure,
          // Certains relais internes n'exigent pas d'authentification — dans ce
          // cas on n'envoie pas de bloc `auth` du tout.
          auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword ?? '' } : undefined,
        }),
      };
    }

    try {
      await this.cachedTransport.transport.sendMail({
        from: config.fromName ? `"${config.fromName}" <${config.fromEmail}>` : config.fromEmail!,
        to,
        subject,
        text,
        html,
      });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      throw new ServiceUnavailableException(`Échec d'envoi de l'email via SMTP: ${reason}`);
    }
  }

  /// Email contenant le code OTP d'inscription — version texte + HTML simple
  /// (certains clients bloquent le HTML, le texte sert de repli).
  async sendOtp(to: string, code: string): Promise<void> {
    await this.send(
      to,
      'Votre code de vérification Vuel',
      `Votre code Vuel : ${code}\n\nCe code expire dans 5 minutes.\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet email.`,
      `<div style="font-family:system-ui,sans-serif;max-width:420px">
         <h2 style="margin:0 0 12px">Vérification de ton compte Vuel</h2>
         <p style="margin:0 0 16px;color:#555">Voici ton code de vérification :</p>
         <p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${code}</p>
         <p style="margin:0;color:#888;font-size:13px">Ce code expire dans 5 minutes. Si tu n'es pas à l'origine de cette demande, ignore cet email.</p>
       </div>`,
    );
  }
}
