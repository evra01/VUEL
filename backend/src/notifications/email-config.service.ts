import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const SINGLETON_ID = 'singleton';

export interface UpdateEmailConfigData {
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
  fromEmail?: string;
  fromName?: string;
}

/// Lecture/écriture de la configuration SMTP (ligne unique en base), calquée sur
/// SmsConfigService. Le mot de passe SMTP n'est jamais renvoyé par l'API admin :
/// getMasked() se contente d'indiquer s'il est renseigné.
@Injectable()
export class EmailConfigService {
  constructor(private prisma: PrismaService) {}

  // Voir le commentaire équivalent dans SmsConfigService.get() : lecture pure
  // dans le cas courant, pas d'écriture à chaque appel.
  async get() {
    const existing = await this.prisma.emailConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (existing) return existing;
    return this.prisma.emailConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
  }

  /// Un envoi n'est possible que si on a au minimum un serveur et une adresse
  /// d'expéditeur. Les identifiants (user/password) restent facultatifs : certains
  /// relais internes acceptent des envois non authentifiés.
  isConfigured(config: { smtpHost: string | null; fromEmail: string | null }) {
    return !!(config.smtpHost && config.fromEmail);
  }

  async getMasked() {
    const config = await this.get();
    return {
      smtpConfigured: this.isConfigured(config),
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpSecure: config.smtpSecure,
      smtpUser: config.smtpUser,
      smtpPasswordSet: !!config.smtpPassword, // le mot de passe lui-même n'est jamais exposé
      fromEmail: config.fromEmail,
      fromName: config.fromName,
      updatedAt: config.updatedAt,
    };
  }

  async update(data: UpdateEmailConfigData) {
    await this.get();
    await this.prisma.emailConfig.update({ where: { id: SINGLETON_ID }, data });
    return this.getMasked();
  }
}
