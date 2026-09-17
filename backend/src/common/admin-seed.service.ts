import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from './prisma.service';
import { normalizePhone } from './normalize-phone';

/// Crée automatiquement un compte ADMIN au démarrage du serveur si aucun
/// n'existe encore en base — utile sur Render, où il n'y a pas de terminal
/// interactif pratique pour lancer `npm run seed:admin` à la main après
/// chaque déploiement initial.
///
/// Contrôlé par les variables d'environnement SEED_ADMIN_PHONE et
/// SEED_ADMIN_PASSWORD. Idempotent : si un ADMIN existe déjà (celui-ci ou un
/// autre créé depuis), ce service ne fait rien au redémarrage suivant.
@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.seedAdminIfNeeded();
    } catch (err) {
      // Ne JAMAIS laisser un souci de seed empêcher le serveur de démarrer —
      // l'app doit rester utilisable même si cette étape échoue pour une
      // raison quelconque (on log l'erreur pour investigation, c'est tout).
      this.logger.error('Échec du seed du compte admin (le serveur démarre quand même) :', err);
    }
  }

  private async seedAdminIfNeeded() {
    const existingAdmin = await this.prisma.user.findFirst({ where: { role: 'ADMIN' } });
    if (existingAdmin) return; // déjà un admin (celui-ci ou créé manuellement) — rien à faire

    const rawPhone = process.env.SEED_ADMIN_PHONE;
    const password = process.env.SEED_ADMIN_PASSWORD;

    if (!rawPhone || !password) {
      this.logger.warn(
        'Aucun compte ADMIN en base, et SEED_ADMIN_PHONE / SEED_ADMIN_PASSWORD ne sont pas définies — ' +
          'aucun admin ne sera créé automatiquement. Définis ces deux variables d\'environnement ' +
          '(sur Render : onglet Environment) puis redéploie pour en créer un.',
      );
      return;
    }

    const phone = normalizePhone(rawPhone);
    const passwordHash = await bcrypt.hash(password, 10);

    // Ce numéro correspond peut-être déjà à un compte PLAYER inscrit normalement
    // (avant que SEED_ADMIN_PHONE soit configuré) — dans ce cas, on le promeut
    // en ADMIN plutôt que d'échouer sur la contrainte d'unicité du téléphone.
    const existingUserWithPhone = await this.prisma.user.findUnique({ where: { phone } });
    if (existingUserWithPhone) {
      await this.prisma.user.update({ where: { id: existingUserWithPhone.id }, data: { role: 'ADMIN' } });
      this.logger.warn(
        `Un compte existait déjà avec ce numéro (${phone}) — promu en ADMIN automatiquement. ` +
          'Son mot de passe reste celui déjà défini lors de son inscription (pas celui de SEED_ADMIN_PASSWORD).',
      );
      return;
    }

    await this.prisma.user.create({
      data: {
        phone,
        pseudo: 'admin',
        passwordHash,
        role: 'ADMIN',
        wallet: { create: { balanceAvailable: 0, balanceLocked: 0 } },
      },
    });

    this.logger.warn(
      `Compte ADMIN créé automatiquement (${phone}) — connecte-toi sur /admin.html puis change ` +
        'ce mot de passe le plus tôt possible (aucun écran de changement de mot de passe pour l\'instant, ' +
        'à faire directement en base si besoin).',
    );
  }
}
