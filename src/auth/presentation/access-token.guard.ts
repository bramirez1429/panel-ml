import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../application/auth.service';
import type { AuthenticatedAccess } from '../application/auth.service';

type RequestWithOptionalAuth = Request & {
  auth?: AuthenticatedAccess;
};

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithOptionalAuth>();
    const token = this.extractBearerToken(request.headers.authorization);
    request.auth = await this.authService.authenticateAccessToken(token);
    return true;
  }

  private extractBearerToken(authorization?: string): string {
    const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? '');
    if (!match || match[1].length > 4096) {
      throw new UnauthorizedException('Access token inv\u00e1lido o vencido');
    }
    return match[1];
  }
}
