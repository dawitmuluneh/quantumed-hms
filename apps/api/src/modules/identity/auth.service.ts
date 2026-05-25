import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';

import { AuditLogService } from '../../common/audit/audit-log.service';
import { FieldEncryptionService } from '../../common/encryption/field-encryption.service';
import { ConflictError, UnauthorizedError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';

import { UsersService } from './users.service';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const REFRESH_TOKEN_BYTES = 48;

export interface LoginContext {
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  hospitalId?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    hospitalId: string | null;
    roles: string[];
    mustRotatePassword: boolean;
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
    private readonly encryption: FieldEncryptionService,
  ) {}

  async login(
    email: string,
    password: string,
    mfaCode: string | undefined,
    ctx: LoginContext,
  ): Promise<AuthTokens> {
    const user = await this.users.findByEmail(ctx.hospitalId ?? null, email);

    if (!user) {
      await this.audit.write({
        action: 'auth.login',
        resource: 'user',
        outcome: 'FAILURE',
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
        payload: { reason: 'unknown_email', email: UsersService.normalizeEmail(email) },
      });
      throw new UnauthorizedError('Invalid email or password', 'LOGIN_INVALID');
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedError('Account is temporarily locked', 'LOGIN_LOCKED');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedError('Account is not active', 'LOGIN_INACTIVE');
    }

    const passwordOk = await this.users.verifyPassword(user.passwordHash, password);
    if (!passwordOk) {
      await this.registerFailedLogin(user.id);
      await this.audit.write({
        action: 'auth.login',
        resource: 'user',
        resourceId: user.id,
        outcome: 'FAILURE',
        actorUserId: user.id,
        hospitalId: user.hospitalId,
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
        payload: { reason: 'wrong_password' },
      });
      throw new UnauthorizedError('Invalid email or password', 'LOGIN_INVALID');
    }

    if (user.mfaEnabled) {
      if (!mfaCode) throw new UnauthorizedError('MFA code required', 'MFA_REQUIRED');
      const secret = user.mfaSecretEnc
        ? await this.encryption.decrypt(user.hospitalId ?? 'platform', user.mfaSecretEnc)
        : '';
      if (!secret || !authenticator.verify({ token: mfaCode, secret })) {
        throw new UnauthorizedError('Invalid MFA code', 'MFA_INVALID');
      }
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    const roles = this.users.rolesOf(user);
    const tokens = await this.issueTokens(user.id, user.hospitalId, user.email, roles, ctx);

    await this.audit.write({
      action: 'auth.login',
      resource: 'user',
      resourceId: user.id,
      outcome: 'SUCCESS',
      actorUserId: user.id,
      hospitalId: user.hospitalId,
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
    });

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        hospitalId: user.hospitalId,
        roles,
        mustRotatePassword: user.mustRotatePassword,
      },
    };
  }

  async refresh(
    refreshToken: string,
    ctx: LoginContext,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = this.hashToken(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!row || row.revokedAt || row.expiresAt < new Date()) {
      // Reuse of an already-revoked token => revoke the whole family.
      if (row?.familyId) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedError('Refresh token is invalid or expired', 'REFRESH_INVALID');
    }
    const user = await this.users.findById(row.userId);
    if (!user) throw new UnauthorizedError('User no longer exists', 'REFRESH_INVALID');

    // Rotate: revoke current, mint a new one in the same family.
    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });
    const roles = this.users.rolesOf(user);
    const tokens = await this.issueTokens(
      user.id,
      user.hospitalId,
      user.email,
      roles,
      ctx,
      row.familyId,
      row.id,
    );
    return tokens;
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = this.hashToken(refreshToken);
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!row) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const user = await this.users.findById(row.userId);
    await this.audit.write({
      action: 'auth.logout',
      resource: 'user',
      resourceId: row.userId,
      actorUserId: row.userId,
      hospitalId: user?.hospitalId ?? null,
      outcome: 'SUCCESS',
      payload: { familyId: row.familyId },
    });
  }

  async enableMfa(userId: string): Promise<{ secret: string; otpauth: string }> {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedError('User not found', 'USER_NOT_FOUND');
    if (user.mfaEnabled) throw new ConflictError('MFA already enabled', 'MFA_ALREADY_ENABLED');
    const secret = authenticator.generateSecret();
    const enc = await this.encryption.encrypt(user.hospitalId ?? 'platform', secret);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecretEnc: enc, mfaEnabled: true },
    });
    await this.audit.write({
      action: 'auth.mfa.enable',
      resource: 'user',
      resourceId: userId,
      actorUserId: userId,
      hospitalId: user.hospitalId,
      outcome: 'SUCCESS',
    });
    const otpauth = authenticator.keyuri(user.email, 'QuantuMed HMS', secret);
    return { secret, otpauth };
  }

  private async registerFailedLogin(userId: string): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });
    if (updated.failedLoginCount >= MAX_FAILED) {
      const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil, failedLoginCount: 0 },
      });
    }
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issueTokens(
    userId: string,
    hospitalId: string | null,
    email: string,
    roles: string[],
    ctx: LoginContext,
    familyId?: string,
    replacedById?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = await this.jwt.signAsync({
      sub: userId,
      email,
      hospitalId,
      roles,
    });
    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const hash = this.hashToken(refreshToken);
    const ttlDays = this.parseDays(this.config.get<string>('JWT_REFRESH_TTL') ?? '14d');
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: familyId ?? randomBytes(16).toString('hex'),
        tokenHash: hash,
        expiresAt,
        userAgent: ctx.userAgent ?? null,
        ipAddress: ctx.ipAddress ?? null,
        replacedById: replacedById ?? null,
      },
    });
    return { accessToken, refreshToken };
  }

  private parseDays(ttl: string): number {
    const m = ttl.match(/^(\d+)([dhms])$/);
    if (!m) return 14;
    const n = Number(m[1]);
    switch (m[2]) {
      case 'd':
        return n;
      case 'h':
        return n / 24;
      case 'm':
        return n / (24 * 60);
      default:
        return n / (24 * 3600);
    }
  }
}
