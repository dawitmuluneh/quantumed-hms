import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SkipTenant } from '../../common/tenant/skip-tenant.decorator';

import { AuthService } from './auth.service';
import { LoginDto, LoginResponseDto, RefreshDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @SkipTenant()
  @Post('login')
  @ApiOperation({ summary: 'Email + password login. Returns access and refresh tokens.' })
  @ApiResponse({ status: 200, type: LoginResponseDto })
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResponseDto> {
    const tokens = await this.auth.login(dto.email, dto.password, dto.mfaCode, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? null,
      hospitalId: (req.headers['x-tenant-id'] as string | undefined) ?? null,
    });
    return tokens;
  }

  @Public()
  @SkipTenant()
  @Post('refresh')
  @ApiOperation({ summary: 'Rotate refresh token and issue new access token.' })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] ?? null,
      requestId: (req.headers['x-request-id'] as string | undefined) ?? null,
    });
  }

  @Public()
  @SkipTenant()
  @Post('logout')
  @ApiOperation({ summary: 'Revoke the supplied refresh token family.' })
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
    return { status: 'ok' };
  }

  @ApiBearerAuth('bearer')
  @SkipTenant()
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return user;
  }
}
