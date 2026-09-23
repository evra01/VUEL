import { Injectable, BadRequestException } from '@nestjs/common';
import { PaymentConfigService } from './payment-config.service';

interface WaveCheckoutSession {
  id: string;
  wave_launch_url: string;
}

/// Intégration Wave Checkout ("paiement par lien") — cf. https://docs.wave.com/business/checkout
/// Le joueur est redirigé vers un lien de paiement hébergé par Wave, puis Wave notifie
/// notre webhook une fois le paiement confirmé (cf. WaveWebhookController).
///
/// INACTIF PAR DÉFAUT : le flux de dépôt actuel (cf. WalletService.deposit) utilise
/// désormais un lien Wave fixe + validation manuelle Telegram (comme Espace Parent),
/// pas cette API Checkout — décision produit pour éviter la dépendance à une clé API
/// Wave Business validée. Ce service est gardé tel quel pour une réactivation future
/// si besoin (il suffirait de rebrancher WalletService.deposit dessus + renseigner
/// PaymentConfig.waveApiKey).
@Injectable()
export class WavePaymentService {
  constructor(private paymentConfig: PaymentConfigService) {}

  async createCheckoutLink(params: { amount: number; transactionId: string }): Promise<WaveCheckoutSession> {
    const config = await this.paymentConfig.get();
    if (!config.waveApiKey) {
      throw new BadRequestException('Wave non configuré — un admin doit renseigner la clé API dans le back-office.');
    }

    const res = await fetch(`${config.waveApiBaseUrl}/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.waveApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: String(params.amount),
        currency: 'XOF',
        client_reference: params.transactionId, // permet de relier le webhook à notre Transaction
        success_url: config.successUrl,
        error_url: config.errorUrl,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new BadRequestException(`Échec de création du lien de paiement Wave: ${body}`);
    }

    const data = (await res.json()) as WaveCheckoutSession;
    return data;
  }

  // TODO: vérifier la signature du webhook Wave (header ex: Wave-Signature) plutôt que
  // de faire confiance à n'importe quel payload — cf. doc Wave pour l'algorithme exact.
  verifyWebhookSignature(_rawBody: string, _signatureHeader: string | undefined): boolean {
    return true; // à implémenter avant la mise en prod
  }
}
