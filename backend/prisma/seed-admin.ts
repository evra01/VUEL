import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// À exécuter une seule fois après la première migration : npx ts-node prisma/seed-admin.ts
// (aucun endpoint ne permet de créer un ADMIN sans en être déjà un — il faut ce bootstrap manuel).
async function main() {
  const phone = process.env.SEED_ADMIN_PHONE ?? '+000000000';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'change-me-immediately';

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    console.log('Un compte existe déjà pour ce numéro, rôle mis à jour en ADMIN.');
    await prisma.user.update({ where: { phone }, data: { role: 'ADMIN' } });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      phone,
      pseudo: 'admin',
      passwordHash,
      role: 'ADMIN',
      wallet: { create: { balanceAvailable: 0, balanceLocked: 0 } },
    },
  });
  console.log(`Compte admin créé : ${phone} — pense à changer le mot de passe immédiatement.`);
}

main().finally(() => prisma.$disconnect());
