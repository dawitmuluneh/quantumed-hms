import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { UnauthorizedError } from '../../../common/errors/domain-error';

export interface JwtPayload {
  sub: string;
  email: string;
  hospitalId: string | null;
  roles: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_ACCESS_SECRET');
    if (!secret) throw new Error('JWT_ACCESS_SECRET must be set');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtPayload): Promise<{
    userId: string;
    email: string;
    hospitalId: string | null;
    roles: string[];
  }> {
    if (!payload?.sub) throw new UnauthorizedError('Malformed token', 'TOKEN_MALFORMED');
    return {
      userId: payload.sub,
      email: payload.email,
      hospitalId: payload.hospitalId,
      roles: payload.roles ?? [],
    };
  }
}
