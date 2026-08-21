import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { errorHandler } from 'supertokens-node/framework/express';

@Catch()
export class SuperTokensExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    // Only handle SuperTokens errors
    if (exception?.type === undefined || !exception?.type?.startsWith?.('GENERAL_ERROR')) {
      throw exception;
    }
    const ctx = host.switchToHttp();
    const handler = errorHandler();
    handler(exception, ctx.getRequest(), ctx.getResponse(), () => {
      throw exception;
    });
  }
}
