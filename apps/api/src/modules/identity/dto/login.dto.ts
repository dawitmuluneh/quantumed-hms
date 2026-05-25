import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'doctor@demo.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'demo123' })
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password!: string;

  @ApiProperty({ required: false, description: '6-digit TOTP code if MFA is enabled' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  mfaCode?: string;
}

export class RefreshDto {
  @ApiProperty()
  @IsString()
  refreshToken!: string;
}

export class LoginResponseDto {
  @ApiProperty()
  accessToken!: string;

  @ApiProperty()
  refreshToken!: string;

  @ApiProperty({ type: 'object', additionalProperties: false })
  user!: {
    id: string;
    email: string;
    fullName: string;
    hospitalId: string | null;
    roles: string[];
    mustRotatePassword: boolean;
  };
}
