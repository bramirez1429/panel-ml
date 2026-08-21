import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from '../application/auth.service';
import type { LoginResult, RefreshResult } from '../application/auth.service';
import type { SafeUser } from '../domain/auth.models';
import type { AuthenticatedRequest } from './authenticated-request';
import { AccessTokenGuard } from './access-token.guard';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: { limit: 3, ttl: 300_000, blockDuration: 300_000 },
  })
  register(@Body() input: RegisterDto): Promise<SafeUser> {
    return this.authService.register(input);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 60_000 } })
  login(@Body() input: LoginDto): Promise<LoginResult> {
    return this.authService.login(input);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 60_000 } })
  refresh(@Body() input: RefreshTokenDto): Promise<RefreshResult> {
    return this.authService.refresh(input);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessTokenGuard)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    await this.authService.logout(request.auth.refreshSessionId);
  }
}
