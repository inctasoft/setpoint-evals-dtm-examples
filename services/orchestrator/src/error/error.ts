import { HttpStatus } from '@nestjs/common';

export enum ErrorCode {
  VALIDATION = 'VALIDATION',
  NOT_FOUND = 'NOT_FOUND',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  CONFLICT = 'CONFLICT',
  DATABASE_ERROR = 'DATABASE_ERROR',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: ErrorCode, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class HttpException extends AppError {
  public readonly statusCode: HttpStatus;
  constructor(
    message: string,
    code: ErrorCode,
    details?: Record<string, unknown>,
    statusCode: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR,
  ) {
    super(message, code, details);
    this.statusCode = statusCode;
  }
}

export class ValidationException extends HttpException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.VALIDATION, details, HttpStatus.BAD_REQUEST);
  }
}

export class NotFoundException extends HttpException {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} with identifier '${identifier}' not found`
      : `${resource} not found`;
    super(message, ErrorCode.NOT_FOUND, { resource, identifier }, HttpStatus.NOT_FOUND);
  }
}

export class UnauthorizedException extends HttpException {
  constructor(message: string = 'Unauthorized access') {
    super(message, ErrorCode.UNAUTHORIZED, undefined, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenException extends HttpException {
  constructor(message: string = 'Forbidden access') {
    super(message, ErrorCode.FORBIDDEN, undefined, HttpStatus.FORBIDDEN);
  }
}

export class InternalServerErrorException extends HttpException {
  constructor(message: string = 'Internal server error', details?: Record<string, unknown>) {
    super(message, ErrorCode.INTERNAL_SERVER_ERROR, details, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}

export class DatabaseException extends HttpException {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, ErrorCode.DATABASE_ERROR, details, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
