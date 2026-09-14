import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const SINGLETON_ID = 'singleton';

@Injectable()
export class PaymentConfigService {
  constructor(private prisma: PrismaService) {}

  // Crée la ligne de config par défaut si elle n'existe pas encore (première utilisation).
  async get() {
    return this.prisma.paymentConfig.upsert({
      where: { id: SINGLETON_ID },
      create: { id: SINGLETON_ID },
      update: {},
    });
  }

  // Vue admin : ne renvoie jamais la clé/le secret en clair, seulement s'ils sont configurés.
  // waveDepositLink n'est pas un secret (c'est un lien de paiement public), donc renvoyé tel quel.
  async getMasked() {
    const config = await this.get();
    return {
      waveDepositLink: config.waveDepositLink,
      waveApiKeyConfigured: !!config.waveApiKey,
      webhookSharedSecretConfigured: !!config.webhookSharedSecret,
      waveApiBaseUrl: config.waveApiBaseUrl,
      successUrl: config.successUrl,
      errorUrl: config.errorUrl,
      updatedAt: config.updatedAt,
    };
  }

  async update(data: {
    waveDepositLink?: string;
    waveApiKey?: string;
    webhookSharedSecret?: string;
    waveApiBaseUrl?: string;
    successUrl?: string;
    errorUrl?: string;
  }) {
    await this.get(); // s'assure que la ligne existe
    return this.prisma.paymentConfig.update({ where: { id: SINGLETON_ID }, data });
  }

  async verifyWebhookSecret(providedSecret: string | undefined): Promise<boolean> {
    const config = await this.get();
    if (!config.webhookSharedSecret) return false; // pas configuré → on refuse par défaut
    return !!providedSecret && providedSecret === config.webhookSharedSecret;
  }
}
