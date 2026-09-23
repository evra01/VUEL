import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET ?? 'change-me-in-env',
    });
  }

  async validate(payload: { sub: string; phone: string; role: string; type?: string }) {
    // Un refreshToken (cf. AuthService.issueTokens, type: 'refresh') ne doit
    // jamais servir à authentifier une requête API classique — sinon il
    // suffirait de le voler une fois pour avoir un accès quasi permanent (30j)
    // au lieu des 15 min prévues pour un accessToken.
    if (payload.type && payload.type !== 'access') {
      throw new UnauthorizedException('Token invalide pour cette opération');
    }
    return { userId: payload.sub, phone: payload.phone, role: payload.role };
  }
}
