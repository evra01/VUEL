import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { OcrAnalysisService } from './ocr-analysis.service';

/// AVANT : cette classe empilait toujours le job dans une queue BullMQ, qui a
/// besoin d'un vrai Redis pour fonctionner. Or `BullModule.forRoot` (cf.
/// app.module.ts) se connectait par défaut à localhost:6379 même quand
/// REDIS_HOST n'était pas défini — et avec `maxRetriesPerRequest: null`
/// (nécessaire pour les commandes bloquantes de BullMQ), `queue.add()`
/// n'échouait JAMAIS : il attendait indéfiniment une connexion Redis qui
/// n'arrivait jamais. Résultat concret : `await this.ocrQueue.enqueue(...)`
/// dans CapturesService.submitProof ne se terminait jamais, la requête HTTP
/// de soumission de preuve restait bloquée jusqu'au timeout côté mobile —
/// "la capture échoue" alors que le code lui-même n'avait rien planté.
///
/// MAINTENANT : la Queue BullMQ n'est injectée (cf. OcrModule) que si
/// REDIS_HOST est réellement défini. Sinon, `queue` est `undefined` et on
/// traite la preuve directement, en tâche de fond, sans jamais bloquer la
/// réponse HTTP de `submitProof`.
@Injectable()
export class OcrQueueService {
  private readonly logger = new Logger(OcrQueueService.name);

  constructor(
    @Optional() @InjectQueue('ocr') private queue: Queue | undefined,
    private ocrAnalysis: OcrAnalysisService,
  ) {}

  async enqueue(proofId: string, imageBase64: string) {
    if (this.queue) {
      await this.queue.add('validate-proof', { proofId, imageBase64 }, { attempts: 3, backoff: 5000 });
      return;
    }

    // Pas de Redis configuré : on traite en tâche de fond (le worker
    // Tesseract.js tourne de toute façon dans ce même process) sans faire
    // attendre la réponse de soumission de preuve. Pas de retry automatique
    // ici (contrairement à BullMQ) — une erreur est simplement journalisée ;
    // l'admin garde la main via l'arbitrage manuel Telegram dans tous les cas.
    setImmediate(() => {
      this.ocrAnalysis.handleProof({ proofId, imageBase64 }).catch((err) => {
        this.logger.error(`Échec du traitement OCR (sans file Redis) pour la preuve ${proofId}:`, err);
      });
    });
  }
}
