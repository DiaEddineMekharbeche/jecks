import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, type RequestWithUser } from '../decorators/auth.decorators.js';

export interface AccessTokenPayload {
  sub: string;
  typ: 'STAFF' | 'CUSTOMER';
  name: string;
  email: string | null;
  phone: string | null;
  roles: string[];
  perms: string[];
  sid: string;
}

/**
 * Verifies the bearer access token and hangs the principal on the request.
 * Registered globally in AppModule, so a route is protected unless it says `@Public()`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = extractToken(request);

    // Public routes still resolve a token when one is present: the storefront needs to
    // know a signed-in shopper without making every catalog route private.
    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in to continue' });
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      request.user = {
        id: payload.sub,
        type: payload.typ,
        name: payload.name,
        email: payload.email,
        phone: payload.phone,
        roles: payload.roles ?? [],
        permissions: payload.perms ?? [],
        sessionId: payload.sid,
      };
      return true;
    } catch {
      if (isPublic) return true;
      throw new UnauthorizedException({
        code: 'TOKEN_INVALID',
        message: 'Your session has expired, please sign in again',
      });
    }
  }
}

function extractToken(request: RequestWithUser): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  // The storefront keeps its access token in a cookie so an RSC render can read it.
  const cookies = request.cookies as Record<string, string> | undefined;
  return cookies?.jk_access ?? null;
}
