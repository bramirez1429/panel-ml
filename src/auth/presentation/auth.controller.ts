import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from '../application/auth.service';
import type { LoginResult, RefreshResult } from '../application/auth.service';
import type { SafeUser } from '../domain/auth.models';
import type { AuthenticatedRequest } from './authenticated-request';
import { AccessTokenGuard } from './access-token.guard';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import {
  clearRefreshTokenCookieOptions,
  readRefreshTokenCookie,
  REFRESH_TOKEN_COOKIE_NAME,
  refreshTokenCookieOptions,
} from './refresh-token.cookie';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 60_000 } })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResult> {
    const result = await this.authService.login(input);
    this.setRefreshCookie(response, result);
    return result;
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000, blockDuration: 60_000 } })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() input: RefreshTokenDto,
  ): Promise<RefreshResult> {
    const refreshToken =
      readRefreshTokenCookie(request.headers.cookie) ??
      input?.refreshToken ??
      '';

    try {
      const result = await this.authService.refresh({ refreshToken });
      this.setRefreshCookie(response, result);
      return result;
    } catch (error) {
      response.clearCookie(
        REFRESH_TOKEN_COOKIE_NAME,
        clearRefreshTokenCookieOptions(),
      );
      throw error;
    }
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(@CurrentUser() user: SafeUser): SafeUser {
    return user;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AccessTokenGuard)
  async logout(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(request.auth.refreshSessionId);
    response.clearCookie(
      REFRESH_TOKEN_COOKIE_NAME,
      clearRefreshTokenCookieOptions(),
    );
  }

  private setRefreshCookie(
    response: Response,
    result: Pick<LoginResult, 'refreshToken' | 'refreshTokenExpiresAt'>,
  ): void {
    response.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      result.refreshToken,
      refreshTokenCookieOptions(result.refreshTokenExpiresAt),
    );
  }
}
