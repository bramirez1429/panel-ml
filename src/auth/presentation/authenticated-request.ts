import { Request } from 'express';
import { AuthenticatedSession } from '../application/auth.service';

export interface AuthenticatedRequest extends Request {
  auth: AuthenticatedSession;
}
