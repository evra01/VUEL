import { Injectable } from '@nestjs/common';
import { RedisService } from '../common/redis.service';

const OTP_TTL_SECONDS = 5 * 60; // 5 minutes

export interface PendingRegistration {
  phone: string;
  pseudo: string;
  email?: string;
  password: string;
  code: string;
}

@Injectable()
export class OtpService {
  constructor(private redis: RedisService) {}

  private key(phone: string) {
    return `otp:register:${phone}`;
  }

  generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  async storePending(data: Omit<PendingRegistration, 'code'>, code: string): Promise<void> {
    const payload: PendingRegistration = { ...data, code };
    await this.redis.client.set(this.key(data.phone), JSON.stringify(payload), 'EX', OTP_TTL_SECONDS);
  }

  async getPending(phone: string): Promise<PendingRegistration | null> {
    const raw = await this.redis.client.get(this.key(phone));
    return raw ? (JSON.parse(raw) as PendingRegistration) : null;
  }

  async clearPending(phone: string): Promise<void> {
    await this.redis.client.del(this.key(phone));
  }
}
