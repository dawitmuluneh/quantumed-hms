import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  static normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  async findByEmail(hospitalId: string | null, email: string) {
    return this.prisma.user.findFirst({
      where: { hospitalId, emailNormalized: UsersService.normalizeEmail(email) },
      include: { roles: { include: { role: true } } },
    });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
  }

  rolesOf(user: { roles: Array<{ role: { code: string } }> }): string[] {
    return user.roles.map((r) => r.role.code);
  }
}
