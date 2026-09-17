import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const SINGLETON_ID = 'singleton';

@Injectable()
export class SmsConfigService {
  constructor(private prisma: PrismaService) {}

  // Lecture pure dans le cas courant (la ligne "singleton" existe déjà après
  // le tout premier appel) — auparavant un upsert() ici faisait une écriture
  // en base à CHAQUE lecture de la config, y compris sur des chemins très
  // fréquents (un SMS envoyé à chaque inscription), ce qui ajoutait une
  // latence évitable. Le create() ne se déclenche que la toute première fois
  // (ligne absente), avec un repli sur un second upsert en cas de course entre
  // deux requêtes concurrentes qui tenteraient toutes deux de la créer.
  async get() {
    const existing = await this.prisma.smsConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (existing) return existing;
    return this.prisma.smsConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
  }

  async getMasked() {
    const config = await this.get();
    return {
      twilioConfigured: !!(config.twilioAccountSid && config.twilioAuthToken && config.twilioFromNumber),
      twilioFromNumber: config.twilioFromNumber, // le numéro expéditeur n'est pas sensible
      updatedAt: config.updatedAt,
    };
  }

  async update(data: { twilioAccountSid?: string; twilioAuthToken?: string; twilioFromNumber?: string }) {
    await this.get();
    return this.prisma.smsConfig.update({ where: { id: SINGLETON_ID }, data });
  }
}
