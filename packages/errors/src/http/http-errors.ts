import { AppError } from "../core/base-error";
import { ErrorCode } from "../core/error-codes";
import { HttpStatus, HttpStatusCode } from "./http-status";

/**
 * HTTP-aware error class
 * Includes HTTP status code for API responses
 */
export class HttpError extends AppError {
  public readonly statusCode: HttpStatusCode;

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: HttpStatusCode = HttpStatus.INTERNAL_SERVER_ERROR,
    details?: Record<string, unknown>,
  ) {
    super(message, code, details);
    this.statusCode = statusCode;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      statusCode: this.statusCode,
    };
  }
}

/**
 * Validation error (400 Bad Request)
 */
export class ValidationError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.VALIDATION, HttpStatus.BAD_REQUEST, details);
  }
}

/**
 * Not found error (404 Not Found)
 */
export class NotFoundError extends HttpError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, ErrorCode.NOT_FOUND, HttpStatus.NOT_FOUND, {
      resource,
      identifier,
    });
  }
}

/**
 * Unauthorized error (401 Unauthorized)
 */
export class UnauthorizedError extends HttpError {
  constructor(message: string = "Unauthorized access") {
    super(message, ErrorCode.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
  }
}

/**
 * Forbidden error (403 Forbidden)
 */
export class ForbiddenError extends HttpError {
  constructor(message: string = "Forbidden access") {
    super(message, ErrorCode.FORBIDDEN, HttpStatus.FORBIDDEN);
  }
}

/**
 * Internal server error (500 Internal Server Error)
 */
export class InternalServerError extends HttpError {
  constructor(
    message: string = "Internal server error",
    details?: Record<string, unknown>,
  ) {
    super(
      message,
      ErrorCode.INTERNAL_SERVER_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      details,
    );
  }
}

/**
 * Database error (500 Internal Server Error)
 */
export class DatabaseError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      ErrorCode.DATABASE_ERROR,
      HttpStatus.INTERNAL_SERVER_ERROR,
      details,
    );
  }
}

/**
 * External service error (502 Bad Gateway)
 */
export class ExternalServiceError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      HttpStatus.BAD_GATEWAY,
      details,
    );
  }
}
