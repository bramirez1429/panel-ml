import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedSession, AuthService } from '../application/auth.service';

type RequestWithOptionalAuth = Request & {
  auth?: AuthenticatedSession;
};

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithOptionalAuth>();
    const token = this.extractBearerToken(request.headers.authorization);
    request.auth = await this.authService.authenticateSession(token);
    return true;
  }

  private extractBearerToken(authorization?: string): string {
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization ?? '');
    if (!match)
      throw new UnauthorizedException('Sesi\u00f3n inv\u00e1lida o vencida');
    return match[1];
  }
}
