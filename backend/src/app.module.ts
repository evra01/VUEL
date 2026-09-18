import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WalletModule } from './wallet/wallet.module';
import { DuelsModule } from './duels/duels.module';
import { CapturesModule } from './captures/captures.module';
import { OcrModule } from './ocr/ocr.module';
import { DisputesModule } from './disputes/disputes.module';
import { AdminModule } from './admin/admin.module';
import { ReputationModule } from './reputation/reputation.module';
import { PaymentsModule } from './payments/payments.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { BannersModule } from './banners/banners.module';
import { WaveMonitorModule } from './wave-monitor/wave-monitor.module';
import { PrismaService } from './common/prisma.service';
import { AdminSeedService } from './common/admin-seed.service';

// BullMQ (utilisé par le module OCR, cf. ocr.module.ts) n'est monté QUE si
// REDIS_HOST est explicitement défini. AVANT, ce forRoot() se connectait par
// défaut à "localhost:6379" même sans REDIS_HOST — en prod (ou tout
// environnement sans Redis local), cette connexion n'aboutissait jamais, et
// combinée à `maxRetriesPerRequest: null`, chaque `queue.add()` restait
// bloqué indéfiniment au lieu d'échouer : c'était la cause du blocage des
// soumissions de captures ("la capture échoue"). Sans REDIS_HOST, le module
// OCR traite maintenant les preuves directement, sans file d'attente
// (cf. OcrQueueService / OcrModule).
const bullModule = process.env.REDIS_HOST
  ? [
      BullModule.forRoot({
        connection: {
          host: process.env.REDIS_HOST,
          port: Number(process.env.REDIS_PORT ?? 6379),
          // Upstash (et la plupart des Redis managés) exigent mot de passe + TLS.
          password: process.env.REDIS_PASSWORD || undefined,
          tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
          // Requis par BullMQ pour les commandes bloquantes (BRPOPLPUSH, etc.) —
          // sans ça, le worker échoue silencieusement dès que Redis limite les
          // retries par requête.
          maxRetriesPerRequest: null,
        },
      }),
    ]
  : [];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Requis au runtime (pas seulement à la compilation) pour que le
    // décorateur @Interval fonctionne (cf. wave-monitor.service.ts) — sans
    // ce forRoot(), @Interval ne lève pas d'erreur mais ne se déclenche
    // jamais.
    ScheduleModule.forRoot(),
    ...bullModule,
    AuthModule,
    UsersModule,
    WalletModule,
    DuelsModule,
    CapturesModule,
    OcrModule,
    DisputesModule,
    AdminModule,
    ReputationModule,
    PaymentsModule,
    TournamentsModule,
    NotificationsModule,
    BannersModule,
    WaveMonitorModule,
  ],
  providers: [PrismaService, AdminSeedService],
})
export class AppModule {}
