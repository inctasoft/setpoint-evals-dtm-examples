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
      req.path === '/health' ||
      req.path === '/health/ready' ||
      req.path === '/health/kafka' ||
      req.headers.upgrade === 'websocket'
    ) {
      return true;
    }

    return new Promise((resolve) => {
      verifySession()(req, res, (err) => {
        resolve(!err);
      });
    });
  }
}
