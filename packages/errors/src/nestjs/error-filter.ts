import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException as NestHttpException,
  Logger,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AppError } from "../core/base-error";
import { ErrorCode } from "../core/error-codes";
import { HttpError } from "../http/http-errors";
import { HttpStatus } from "../http/http-status";

/**
 * Global NestJS exception filter
 * Catches all errors and formats them consistently
 */
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
    // Our HttpError (includes statusCode)
    if (exception instanceof HttpError) {
      return {
        status: exception.statusCode,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    // NestJS built-in HttpException
    if (exception instanceof NestHttpException) {
      const responseBody = exception.getResponse();

      return {
        status: exception.getStatus(),
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        message: exception.message,
        ...(typeof responseBody === "object"
          ? { details: responseBody as Record<string, unknown> }
          : {}),
      };
    }

    // Our base AppError (no statusCode)
    if (exception instanceof AppError) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    // Unknown errors
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      message:
        exception instanceof Error
          ? exception.message
          : "Internal server error",
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
