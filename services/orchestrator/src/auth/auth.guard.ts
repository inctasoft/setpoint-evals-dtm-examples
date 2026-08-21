import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { verifySession } from 'supertokens-node/recipe/session/framework/express';

@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();

    // Allow auth routes, health checks, and WebSocket upgrades
    if (
      req.path.startsWith('/auth') ||
      req.path.endsWith('/health') ||
      req.path.endsWith('/health/ready') ||
      req.path.endsWith('/health/kafka') ||
      req.headers.upgrade === 'websocket'
    ) {
      return true;
    }

    // Dev escape hatch: when DISABLE_AUTH=true the guard waves every request
    // through. Used by the local SE suite (it has no SuperTokens session) and
    // by `pnpm dev`. Production must NOT set this; the .env.example default
    // (true) is dev-only and overridden by deploy-time env injection.
    if (process.env.DISABLE_AUTH === 'true') {
      return true;
    }

    return new Promise((resolve) => {
      verifySession()(req, res, (err) => {
        resolve(!err);
      });
    });
  }
}
