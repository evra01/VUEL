import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { OcrAnalysisService } from './ocr-analysis.service';

/// Mince wrapper BullMQ : uniquement instancié quand REDIS_HOST est défini
/// (cf. OcrModule) — toute la vraie logique vit maintenant dans
/// OcrAnalysisService.handleProof, réutilisable avec ou sans Redis.
@Processor('ocr')
export class OcrProcessor extends WorkerHost {
  constructor(private ocrAnalysis: OcrAnalysisService) {
    super();
  }

  async process(job: Job<{ proofId: string; imageBase64: string }>) {
    return this.ocrAnalysis.handleProof(job.data);
  }
}
