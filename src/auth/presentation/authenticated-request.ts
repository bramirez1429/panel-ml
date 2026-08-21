import type { Request } from 'express';
import type { AuthenticatedAccess } from '../application/auth.service';

export interface AuthenticatedRequest extends Request {
  auth: AuthenticatedAccess;
}
