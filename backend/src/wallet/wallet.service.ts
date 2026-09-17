import { Prisma } from '@prisma/client';
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { PaymentConfigService } from '../payments/payment-config.service';
import { TelegramNotifierService } from '../notifications/telegram-notifier.service';
import { DepositDto, WithdrawDto } from './dto/wallet.dto';

// NOTE : WalletModule importe NotificationsModule (pour TelegramNotifierService,
// ci-dessous) ET NotificationsModule importe WalletModule (pour que
// TelegramCommandsService appelle approveDeposit/rejectDeposit depuis les
// boutons de décision Telegram) — dépendance circulaire entre les deux
// modules, résolue avec forwardRef() côté imports des deux modules
// (cf. wallet.module.ts / notifications.module.ts).
@Injectable()
export class WalletService {
  constructor(
    private prisma: PrismaService,
    private paymentConfig: PaymentConfigService,
    private telegram: TelegramNotifierService,
  ) {}

  getWallet(userId: string) {
    return this.prisma.wallet.findUnique({ where: { userId } });
  }

  getTransactions(userId: string) {
    return this.prisma.transaction.findMany({
      where: { wallet: { userId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Crée une transaction PENDING et renvoie le lien Wave fixe (configuré par
  // l'admin, cf. PaymentConfig.waveDepositLink) à ouvrir côté client mobile
  // (navigateur/webview) — même principe qu'Espace Parent : pas d'API Wave
  // Business, le joueur saisit le numéro avec lequel il va payer, et un admin
  // valide manuellement le dépôt une fois le paiement vérifié sur le compte
  // Wave (cf. approveDeposit, déclenché depuis les boutons Telegram —
  // TelegramCommandsService). Le passage à SUCCESS ne se fait donc PAS via un
  // webhook Wave automatique.
  async deposit(userId: string, dto: DepositDto) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    const config = await this.paymentConfig.get();
    if (!config.waveDepositLink) {
      throw new BadRequestException('Dépôt Wave non configuré — un admin doit renseigner le lien Wave dans le back-office.');
    }

    const transaction = await this.prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEPOSIT',
        amount: dto.amount,
        provider: 'wave',
        status: 'PENDING',
        payerPhone: dto.phoneNumber,
      },
    });

    const paymentUrl = this.buildDepositUrl(config.waveDepositLink, dto.amount);

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { pseudo: true } });
    await this.notifyAdminForDepositValidation(transaction.id, dto, user?.pseudo ?? userId);

    return { transaction, paymentUrl };
  }

  // Ajoute le montant en query param au lien Wave fixe (même logique qu'Espace
  // Parent) — purement indicatif pour le joueur/l'app Wave, ça ne fiabilise
  // pas la détection du montant reçu côté admin (d'où la vérification
  // manuelle avant de valider, cf. approveDeposit).
  private buildDepositUrl(depositLink: string, amount: number): string {
    const separator = depositLink.includes('?') ? '&' : '?';
    return `${depositLink}${separator}amount=${amount}`;
  }

  // Notifie l'admin sur Telegram avec les mêmes boutons de décision que
  // l'arbitrage des duels (cf. TelegramNotifierService.sendDecisionButtons) —
  // callback_data "dep:ok:<transactionId>" / "dep:no:<transactionId>", traités
  // par TelegramCommandsService qui appelle approveDeposit/rejectDeposit.
  private async notifyAdminForDepositValidation(
    transactionId: string,
    dto: DepositDto,
    pseudo: string,
  ): Promise<void> {
    const text =
      `💰 Nouvelle demande de dépôt Wave\n` +
      `Joueur : ${pseudo}\n` +
      `Montant : ${dto.amount} XOF\n` +
      `Numéro utilisé pour payer : ${dto.phoneNumber}\n\n` +
      `Vérifie la réception sur le compte Wave avant de valider.`;

    await this.telegram.sendDecisionButtons(undefined, text, [
      [
        { text: '✅ Paiement reçu — créditer', callbackData: `dep:ok:${transactionId}` },
        { text: '❌ Rejeter', callbackData: `dep:no:${transactionId}` },
      ],
    ]);
  }

  // Déclenché depuis le bouton "✅ Paiement reçu" sur Telegram (cf.
  // TelegramCommandsService) une fois qu'un admin a vérifié à la main que le
  // paiement est bien arrivé sur le compte Wave. Idempotent : un dépôt déjà
  // traité (SUCCESS ou FAILED) n'est jamais recrédité.
  async approveDeposit(transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) {
      throw new BadRequestException('Transaction introuvable.');
    }
    if (transaction.type !== 'DEPOSIT') {
      throw new BadRequestException("Cette transaction n'est pas un dépôt.");
    }
    if (transaction.status !== 'PENDING') {
      return transaction; // déjà traité — on ignore silencieusement (idempotent)
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updated = await tx.transaction.update({
        where: { id: transactionId },
        data: { status: 'SUCCESS' },
      });
      await tx.wallet.update({
        where: { id: transaction.walletId },
        data: { balanceAvailable: { increment: transaction.amount } },
      });
      return updated;
    });
  }

  // Déclenché depuis le bouton "❌ Rejeter" sur Telegram — ex: numéro erroné,
  // paiement jamais reçu. Aucun crédit sur le wallet.
  async rejectDeposit(transactionId: string) {
    const transaction = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!transaction) {
      throw new BadRequestException('Transaction introuvable.');
    }
    if (transaction.status !== 'PENDING') {
      return transaction; // déjà traité — on ignore silencieusement (idempotent)
    }
    return this.prisma.transaction.update({ where: { id: transactionId }, data: { status: 'FAILED' } });
  }

  async withdraw(userId: string, dto: WithdrawDto) {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { userId } });
    if (wallet.balanceAvailable < dto.amount) {
      throw new BadRequestException('Solde insuffisant');
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: { balanceAvailable: { decrement: dto.amount } },
      });
      return tx.transaction.create({
        data: {
          walletId: wallet.id,
          type: 'WITHDRAW',
          amount: dto.amount,
          provider: dto.provider,
          status: 'PENDING',
        },
      });
      // TODO: déclencher PaymentProviderService.initiateWithdraw(tx, dto.provider)
    });
  }
}
