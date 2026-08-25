import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import type { SafeUser } from '../auth/domain/auth.models';
import type { AuthenticatedRequest } from '../auth/presentation/authenticated-request';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import { MercadolibreAuthService } from './auth/mercadolibre-auth.service';
import { MercadolibreTokenService } from './auth/mercadolibre-token.service';
import { OAUTH_STATE_TTL_MS } from './shared/mercadolibre.config';

@Controller('mercadolibre')
export class MercadolibreController {
  /** Recibe el servicio de autenticación. */
  constructor(
    private readonly authService: MercadolibreAuthService,
    private readonly tokenService: MercadolibreTokenService,
  ) {}

  @Get('connection')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  connection(@CurrentUser() user: SafeUser) {
    return this.tokenService.getConnectionStatus(user.id);
  }

  @Delete('connection')
  @UseGuards(AccessTokenGuard)
  async disconnect(@CurrentUser() user: SafeUser): Promise<{ ok: true }> {
    await this.tokenService.disconnect(user.id);
    return { ok: true };
  }

  /** Entrega la URL para autorizar la cuenta desde un cliente autenticado. */
  @Get('connect')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  async connect(
    @CurrentUser() user: SafeUser,
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ url: string }> {
    const authorization = await this.authService.createAuthorizationRequest(
      user.id,
      request.auth.refreshSessionId,
    );
    response.cookie(
      authorization.cookieName,
      authorization.browserBinding,
      oauthCookieOptions(authorization.secureCookie, authorization.cookiePath),
    );
    return { url: authorization.url };
  }

  /** Valida OAuth y guarda la conexión en Supabase. */
  @Get('callback')
  @Header('Cache-Control', 'no-store')
  async callback(
    @Res({ passthrough: true }) response: Response,
    @Headers('cookie') cookieHeader?: string,
    @Query('code') code?: unknown,
    @Query('state') state?: unknown,
    @Query('error') error?: unknown,
    @Query('error_description') errorDescription?: unknown,
  ) {
    const parsedCode = optionalQueryString(code);
    const parsedState = optionalQueryString(state);
    const parsedError = optionalQueryString(error);
    const parsedErrorDescription = optionalQueryString(errorDescription);
    const cookieName = parsedState
      ? this.authService.getAuthorizationCookieName(parsedState)
      : null;
    const browserBinding = cookieName
      ? readCookie(cookieHeader, cookieName)
      : undefined;
    const userId = parsedState
      ? await this.authService.verifyState(parsedState, browserBinding)
      : null;
    if (!userId) {
      throw new UnauthorizedException('El state es inválido o venció');
    }
    if (cookieName) {
      response.clearCookie(cookieName, {
        path: this.authService.getCallbackCookiePath(),
      });
    }

    if (parsedError || parsedErrorDescription) {
      throw new BadRequestException(
        'La autorización de Mercado Libre fue cancelada o rechazada',
      );
    }

    if (!parsedCode?.trim()) {
      throw new BadRequestException('Falta el código de autorización');
    }

    const tokens = await this.authService.exchangeCode(parsedCode);
    const seller = await this.authService.getCurrentUser(tokens.access_token);
    await this.authService.saveTokens(userId, seller, tokens);

    return {
      ok: true,
      message: 'Mercado Libre conectado correctamente',
      seller,
    };
  }
}

function oauthCookieOptions(secure: boolean, path: string): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path,
    maxAge: OAUTH_STATE_TTL_MS,
  };
}

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    return part.slice(separator + 1).trim();
  }
  return undefined;
}

function optionalQueryString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException('Parámetros OAuth inválidos');
  }
  return value;
}
