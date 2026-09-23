import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

const SINGLETON_ID = 'singleton';

@Injectable()
export class PaymentConfigService {
  constructor(private prisma: PrismaService) {}

  // Voir le commentaire équivalent dans SmsConfigService.get() : lecture pure
  // dans le cas courant, pas d'écriture à chaque appel — ici en particulier,
  // get() est appelé à CHAQUE dépôt Wave (cf. WalletService.deposit), donc
  // l'upsert systématique ajoutait une écriture superflue sur un chemin très
  // fréquent.
  async get() {
    const existing = await this.prisma.paymentConfig.findUnique({ where: { id: SINGLETON_ID } });
    if (existing) return existing;
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
    // Le secret peut être configuré en base (via PATCH /admin/payment-config,
    // le chemin normal) OU via la variable d'environnement VUEL_WEBHOOK_SECRET
    // côté Render (fallback pratique quand on n'a pas encore de compte admin /
    // pas d'accès Shell pour lancer seed-admin.ts). La valeur en base est
    // prioritaire si les deux sont définies.
    const expected = config.webhookSharedSecret || process.env.VUEL_WEBHOOK_SECRET;
    if (!expected) return false; // ni base ni env → on refuse par défaut
    return !!providedSecret && providedSecret === expected;
  }
}
