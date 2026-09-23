import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma.service';
import { PaymentConfigService } from '../payments/payment-config.service';
import { TelegramNotifierService } from '../notifications/telegram-notifier.service';
import { WalletService } from '../wallet/wallet.service';
import { WaveSessionService } from './wave-session.service';

const POLL_INTERVAL_MS = 30_000;

/// Portage de wave_monitor.py (projet "Relais Cabine") vers Vuel : remplace la
/// validation manuelle Telegram des dépôts Wave (cf. WalletService.deposit /
/// approveDeposit) par une validation AUTOMATIQUE — toutes les 30s, on
/// compare les paiements reçus sur le compte Wave Business (cf.
/// WaveSessionService) aux dépôts PENDING en base, et on crédite dès qu'un
/// paiement correspond.
///
/// Matching : montant identique ET numéro payeur identique (les 8 derniers
/// chiffres, pour tolérer les préfixes +225/00225/0) — plus fiable que
/// l'ancienne version standalone qui ne matchait que sur le montant (elle
/// n'avait pas de numéro de payeur saisi côté app). Le numéro saisi par le
/// joueur avant de payer (cf. Transaction.payerPhone / wallet_tab.dart côté
/// mobile) est donc désormais utilisé, pas seulement affiché à l'admin.
///
/// Reste actif en PARALLÈLE de la validation manuelle Telegram : si le
/// monitor ne trouve pas de correspondance (session Wave expirée, numéro mal
/// saisi, etc.), l'admin peut toujours valider à la main depuis les boutons
/// Telegram existants — approveDeposit() est idempotent des deux côtés.
@Injectable()
export class WaveMonitorService {
  private readonly logger = new Logger(WaveMonitorService.name);
  private running = false; // évite un chevauchement si un cycle dépasse 30s
  private lastSessionAlertAt: number | null = null;

  constructor(
    private prisma: PrismaService,
    private paymentConfig: PaymentConfigService,
    private waveSession: WaveSessionService,
    private walletService: WalletService,
    private telegram: TelegramNotifierService,
  ) {}

  @Interval(POLL_INTERVAL_MS)
  async tick() {
    if (this.running) return; // cycle précédent pas terminé (paiements/DB lents) — on saute
    this.running = true;
    try {
      await this.checkAndValidate();
    } catch (err) {
      this.logger.error('Erreur pendant le cycle de vérification Wave:', err as Error);
    } finally {
      this.running = false;
    }
  }

  private async checkAndValidate() {
    const config = await this.paymentConfig.get();
    if (!config.waveMonitorEnabled) return;

    const sessionValid = await this.waveSession.isSessionValid();
    if (!sessionValid) {
      await this.alertSessionExpiredOnce();
      return;
    }
    this.lastSessionAlertAt = null; // session valide → prochaine expiration réalertera normalement

    const payments = await this.waveSession.getTodayIncomingPayments();
    if (payments.length === 0) return;

    const pendingDeposits = await this.prisma.transaction.findMany({
      where: { type: 'DEPOSIT', status: 'PENDING', provider: 'wave' },
    });
    if (pendingDeposits.length === 0) return;

    for (const payment of payments) {
      const alreadySeen = await this.prisma.waveSeenTransaction.findUnique({ where: { id: payment.id } });
      if (alreadySeen) continue;

      const match = pendingDeposits.find(
        (dep) =>
          dep.amount === payment.amount &&
          !!dep.payerPhone &&
          this.normalizePhone(dep.payerPhone) === this.normalizePhone(payment.senderMobile ?? ''),
      );

      if (!match) continue; // pas de correspondance ce cycle — retenté au prochain, jamais marqué "vu"

      await this.prisma.waveSeenTransaction.create({ data: { id: payment.id } });
      const approved = await this.walletService.approveDeposit(match.id);
      if (approved.status !== 'SUCCESS') continue; // déjà traité (rejeté) entre-temps — rien à notifier

      this.logger.log(`Dépôt #${match.id} validé automatiquement — ${payment.amount} XOF de ${payment.senderMobile}`);
      await this.telegram.sendMessage(
        `✅ Dépôt Wave validé automatiquement par le monitor\n` +
          `Montant : ${payment.amount} XOF\n` +
          `Numéro payeur : ${payment.senderMobile ?? '?'}\n` +
          `Transaction : ${match.id}`,
      );
    }
  }

  // Une seule alerte Telegram par expiration (pas une toutes les 30s) —
  // remise à zéro dès que la session redevient valide (cf. reconnexion admin
  // via WaveMonitorAdminController).
  private async alertSessionExpiredOnce() {
    const now = Date.now();
    if (this.lastSessionAlertAt && now - this.lastSessionAlertAt < 30 * 60 * 1000) return; // pas plus d'une alerte / 30 min
    this.lastSessionAlertAt = now;
    await this.telegram.sendMessage(
      '⚠️ Wave Monitor : session Wave Business expirée ou non connectée.\n' +
        "Les dépôts ne seront plus validés automatiquement jusqu'à reconnexion " +
        "(back-office admin → Wave Monitor → Se connecter, puis code OTP).",
    );
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return digits.slice(-8); // 8 derniers chiffres du numéro CI, insensible aux préfixes +225/00225/0
  }
}
