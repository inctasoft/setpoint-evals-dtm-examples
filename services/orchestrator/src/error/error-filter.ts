import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException as NestHttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AppError, ErrorCode, HttpException } from './error';

@Catch()
export class GlobalErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();
    const { status, code, message, details } = this.extractError(exception);
    // Log the error
    this.logError(exception, request, status, code, message);
    // Send the response
    response.status(status).json({
      code,
      message,
      ...(details && { details }),
    });
  }

  private extractError(exception: unknown): {
    status: number;
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof HttpException) {
      return {
        status: exception.statusCode,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof NestHttpException) {
      const responseBody = exception.getResponse();
      const status = exception.getStatus() as HttpStatus;

      let code = ErrorCode.INTERNAL_SERVER_ERROR;
      switch (status) {
        case HttpStatus.BAD_REQUEST:
          code = ErrorCode.VALIDATION;
          break;
        case HttpStatus.UNAUTHORIZED:
          code = ErrorCode.UNAUTHORIZED;
          break;
        case HttpStatus.FORBIDDEN:
          code = ErrorCode.FORBIDDEN;
          break;
        case HttpStatus.NOT_FOUND:
          code = ErrorCode.NOT_FOUND;
          break;
        case HttpStatus.CONFLICT:
          code = ErrorCode.CONFLICT;
          break;
      }

      return {
        status,
        code,
        message: exception.message,
        ...(typeof responseBody === 'object'
          ? { details: responseBody as Record<string, unknown> }
          : {}),
      };
    }

    if (exception instanceof AppError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message: exception instanceof Error ? exception.message : 'Internal server error',
      details: undefined,
    };
  }

  private logError(
    exception: unknown,
    request: Request,
    status: number,
    code: ErrorCode,
    message: string,
  ): void {
    const context = `[${request.method}] ${request.url} - ${status} - ${code}`;

    if (status >= 500) {
      this.logger.error(
        `${context}\n${exception instanceof Error ? exception.stack : JSON.stringify(exception)}`,
      );
    } else {
      this.logger.warn(`${context} - ${message}`);
    }
  }
}
