import { TransactionStatus } from '@prisma/client';

// Labels FR affichés côté back-office pour le statut d'une demande de retrait
// (cf. AdminController listWithdrawals/approve/reject/markOther). FAILED n'est
// volontairement pas mappé ici : il reste réservé aux dépôts Wave rejetés
// (cf. WalletService.rejectDeposit), jamais utilisé pour un retrait — voir
// WITHDRAWAL_STATUSES ci-dessous pour l'ensemble des statuts valides côté retrait.
export const WITHDRAWAL_STATUS_LABELS: Record<string, string> = {
  PENDING: 'En cours',
  SUCCESS: 'Effectué',
  CANCELLED: 'Annulé',
  OTHER: 'Autre',
};

// Les seuls statuts qu'une Transaction de type WITHDRAW peut prendre — utilisé
// pour valider les transitions dans AdminController (une demande déjà
// "Effectué"/"Annulé"/"Autre" ne peut plus être modifiée depuis les actions
// approve/reject/markOther, seul PENDING est une étape intermédiaire).
export const WITHDRAWAL_STATUSES: TransactionStatus[] = ['PENDING', 'SUCCESS', 'CANCELLED', 'OTHER'];

export function withdrawalStatusLabel(status: string): string {
  return WITHDRAWAL_STATUS_LABELS[status] ?? status;
}
