import { Logger } from "@nestjs/common";
import { AppError } from "../core/base-error";
import { ErrorCode } from "../core/error-codes";

/**
 * NestJS error handler utility
 * Provides consistent error logging
 */
export class ErrorHandler {
  private static readonly logger = new Logger(ErrorHandler.name);

  /**
   * Catch and log an error with optional context
   */
  static catch(error: AppError | Error, context?: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorCode =
      error instanceof AppError ? error.code : ErrorCode.INTERNAL_SERVER_ERROR;

    const logMessage = `${context ? `[${context}]` : ""} Error (${errorCode}): ${errorMessage}`;

    this.logger.error(logMessage, errorStack, {
      message: errorMessage,
      stack: errorStack,
      name: error instanceof Error ? error.name : "Unknown",
      code: errorCode,
      context: context,
      ...(error instanceof AppError && { details: error.details }),
    });

    // TODO: Integration with DataDog monitoring
  }
}
