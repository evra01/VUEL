import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma.service';
import { SmsService } from '../notifications/sms.service';
import { OtpService } from './otp.service';
import { RegisterDto, VerifyOtpDto, LoginDto } from './dto/auth.dto';
import { normalizePhone } from '../common/normalize-phone';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private otp: OtpService,
    private sms: SmsService,
  ) {}

  // Étape 1 : l'utilisateur soumet ses infos, on génère et envoie un OTP par SMS.
  // Le compte n'est créé qu'après vérification de l'OTP (voir verifyOtp).
  async register(dto: RegisterDto) {
    const phone = normalizePhone(dto.phone);
    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) throw new ConflictException('Numéro déjà utilisé');

    const code = this.otp.generateCode();
    await this.otp.storePending({ ...dto, phone }, code);
    await this.sms.send(phone, `Votre code Vuel : ${code}`);

    return { message: 'OTP envoyé', phone };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const phone = normalizePhone(dto.phone);
    const pending = await this.otp.getPending(phone);
    if (!pending || pending.code !== dto.code) {
      throw new UnauthorizedException('Code OTP invalide ou expiré');
    }

    const passwordHash = await bcrypt.hash(pending.password, 10);
    const user = await this.prisma.user.create({
      data: {
        phone: pending.phone,
        pseudo: pending.pseudo,
        email: pending.email,
        passwordHash,
        wallet: { create: { balanceAvailable: 0, balanceLocked: 0 } },
      },
    });
    await this.otp.clearPending(phone);

    return this.issueTokens(user.id, user.phone, user.role);
  }

  async login(dto: LoginDto) {
    const phone = normalizePhone(dto.phone);
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Identifiants invalides');
    }
    return this.issueTokens(user.id, user.phone, user.role);
  }

  // Échange un refreshToken (durée de vie 30j) contre une nouvelle paire de
  // tokens — c'est ce qui évite à l'utilisateur de retaper ses identifiants
  // dès que l'accessToken (15 min) expire : le client mobile appelle cette
  // route en silence dès qu'il reçoit un 401, au lieu de forcer une
  // reconnexion manuelle. On fait tourner (rotate) le refreshToken à chaque
  // appel plutôt que de le réutiliser tel quel, par précaution standard.
  async refresh(refreshToken: string) {
    let payload: { sub: string; phone: string; role: string; type?: string };
    try {
      payload = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Session expirée — reconnecte-toi');
    }
    if (payload.type !== 'refresh') {
      // Empêche d'utiliser un accessToken (courte durée) à la place d'un
      // refreshToken pour prolonger indéfiniment une session.
      throw new UnauthorizedException('Token invalide pour cette opération');
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new UnauthorizedException('Session expirée — reconnecte-toi');

    return this.issueTokens(user.id, user.phone, user.role);
  }

  private issueTokens(userId: string, phone: string, role: string) {
    return {
      accessToken: this.jwt.sign({ sub: userId, phone, role, type: 'access' }, { expiresIn: '15m' }),
      refreshToken: this.jwt.sign({ sub: userId, phone, role, type: 'refresh' }, { expiresIn: '30d' }),
    };
  }
}
