import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const SINGLETON_ID = 'singleton';

@Injectable()
export class SmsConfigService {
  constructor(private prisma: PrismaService) {}

  async get() {
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
