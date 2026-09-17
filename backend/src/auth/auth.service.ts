import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma.service';
import { SmsService } from '../notifications/sms.service';
import { EmailService } from '../notifications/email.service';
import { OtpService } from './otp.service';
import { RegisterDto, VerifyOtpDto, LoginDto } from './dto/auth.dto';
import { normalizePhone } from '../common/normalize-phone';

/// Extrait un motif d'échec lisible d'un Promise.allSettled rejeté.
function reasonOf(result: PromiseRejectedResult): string {
  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

/// N'expose qu'une version tronquée de l'adresse dans la réponse d'inscription
/// (ex: "jo***@gmail.com") — assez pour que l'utilisateur reconnaisse sa boîte
/// sans divulguer l'adresse complète à qui intercepterait la réponse.
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private otp: OtpService,
    private sms: SmsService,
    private email: EmailService,
  ) {}

  private readonly logger = new Logger(AuthService.name);

  // Étape 1 : l'utilisateur soumet ses infos, on génère et envoie un OTP.
  // Le compte n'est créé qu'après vérification de l'OTP (voir verifyOtp).
  //
  // Le code part systématiquement par SMS ET par email (l'adresse est
  // obligatoire à l'inscription) : les deux canaux échouent régulièrement de
  // façon indépendante (SMS bloqué par l'opérateur, boîte pleine, spam…), donc
  // on tente les deux en parallèle et l'inscription passe dès qu'au moins un
  // envoi aboutit. On n'échoue que si les DEUX sont tombés — sinon
  // l'utilisateur resterait bloqué alors qu'il a bel et bien reçu son code.
  async register(dto: RegisterDto) {
    const phone = normalizePhone(dto.phone);
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { phone } });
    if (existing) throw new ConflictException('Numéro déjà utilisé');

    // User.email est @unique : on vérifie avant l'envoi plutôt que de laisser
    // la contrainte exploser à la création du compte, après la saisie de l'OTP.
    const emailTaken = await this.prisma.user.findUnique({ where: { email } });
    if (emailTaken) throw new ConflictException('Email déjà utilisé');

    const code = this.otp.generateCode();
    await this.otp.storePending({ ...dto, phone, email }, code);

    const [smsResult, emailResult] = await Promise.allSettled([
      this.sms.send(phone, `Votre code Vuel : ${code}`),
      this.email.sendOtp(email, code),
    ]);

    const smsSent = smsResult.status === 'fulfilled';
    const emailSent = emailResult.status === 'fulfilled';

    if (smsResult.status === 'rejected') {
      this.logger.error(`Échec envoi OTP par SMS à ${phone}: ${reasonOf(smsResult)}`);
    }
    if (emailResult.status === 'rejected') {
      this.logger.error(`Échec envoi OTP par email à ${email}: ${reasonOf(emailResult)}`);
    }

    if (!smsSent && !emailSent) {
      throw new ServiceUnavailableException(
        "Impossible d'envoyer le code pour le moment — réessaie dans quelques instants.",
      );
    }

    return {
      message: 'OTP envoyé',
      phone,
      // Permet au client d'afficher précisément où regarder ("SMS + email", ou
      // seulement l'un des deux si l'autre a échoué).
      channels: { sms: smsSent, email: emailSent },
      email: maskEmail(email),
    };
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
