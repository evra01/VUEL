import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Protège les routes nécessitant un utilisateur authentifié (JWT access token).
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
