import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Query,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import type { SafeUser } from '../auth/domain/auth.models';
import { AccessTokenGuard } from '../auth/presentation/access-token.guard';
import { CurrentUser } from '../auth/presentation/current-user.decorator';
import { TiendanubeOAuthService } from './auth/tiendanube-oauth.service';
import {
  TiendanubeConnectionService,
  type TiendanubeConnectionStatus,
} from './connections/tiendanube-connection.service';
import { TIENDANUBE_OAUTH_STATE_TTL_MS } from './shared/tiendanube.config';

export type TiendanubeHealthResponse = Readonly<{
  ok: true;
  service: 'tiendanube';
}>;

@Controller('tiendanube')
export class TiendanubeController {
  constructor(
    private readonly oauthService: TiendanubeOAuthService,
    private readonly connectionService: TiendanubeConnectionService,
  ) {}

  @Get('health')
  health(): TiendanubeHealthResponse {
    return {
      ok: true,
      service: 'tiendanube',
    };
  }

  @Get('connection')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  async connection(
    @CurrentUser() user: SafeUser,
  ): Promise<TiendanubeConnectionStatus> {
    const status = await this.connectionService.getStatus(user.id);

    if (!status.connected) return { connected: false };

    return {
      connected: true,
      storeId: status.storeId,
      scope: status.scope,
    };
  }

  @Delete('connection')
  @UseGuards(AccessTokenGuard)
  async disconnect(@CurrentUser() user: SafeUser): Promise<{ ok: true }> {
    await this.connectionService.disconnect(user.id);
    return { ok: true };
  }

  @Get('connect')
  @Header('Cache-Control', 'no-store')
  @UseGuards(AccessTokenGuard)
  connect(
    @CurrentUser() user: SafeUser,
    @Res({ passthrough: true }) response: Response,
  ): { url: string } {
    const authorization = this.oauthService.createAuthorizationRequest(user.id);

    response.cookie(
      authorization.cookieName,
      authorization.browserBinding,
      oauthCookieOptions(authorization.secureCookie, authorization.cookiePath),
    );

    return { url: authorization.url };
  }

  @Get('callback')
  @Header('Cache-Control', 'no-store')
  async callback(
    @Res({ passthrough: true }) response: Response,
    @Headers('cookie') cookieHeader?: string,
    @Query('code') code?: unknown,
    @Query('state') state?: unknown,
  ): Promise<{
    ok: true;
    storeId: string;
    scope: string;
  }> {
    const parsedCode = requiredQueryString(
      code,
      'Falta el código de autorización',
    );
    const parsedState = requiredQueryString(state, 'Falta el state OAuth');
    const cookieName =
      this.oauthService.getAuthorizationCookieName(parsedState);
    const browserBinding = cookieName
      ? readCookie(cookieHeader, cookieName)
      : undefined;
    const userId = this.oauthService.verifyState(parsedState, browserBinding);

    if (!userId) {
      throw new UnauthorizedException(
        'El state de Tiendanube es inválido o venció',
      );
    }

    if (cookieName) {
      response.clearCookie(cookieName, {
        path: this.oauthService.getCallbackCookiePath(),
      });
    }

    const connection = await this.oauthService.completeAuthorization(
      userId,
      parsedCode,
    );

    return {
      ok: true,
      storeId: connection.storeId,
      scope: connection.scope,
    };
  }
}

function oauthCookieOptions(secure: boolean, path: string): CookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path,
    maxAge: TIENDANUBE_OAUTH_STATE_TTL_MS,
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

function requiredQueryString(value: unknown, missingMessage: string): string {
  if (value === undefined) {
    throw new BadRequestException(missingMessage);
  }

  if (typeof value !== 'string') {
    throw new BadRequestException('Parámetros OAuth inválidos');
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new BadRequestException(missingMessage);
  }

  return normalized;
}
