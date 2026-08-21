// Core (framework-agnostic)
export { ErrorCode } from "./core/error-codes";
export { AppError } from "./core/base-error";

// HTTP errors (for APIs)
export { HttpStatus, HttpStatusCode } from "./http/http-status";
export {
  HttpError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  InternalServerError,
  DatabaseError,
  ExternalServiceError,
} from "./http/http-errors";

// Utils
export { ILogger, ConsoleLogger } from "./utils/logger";

// NestJS adapters (only available if @nestjs/common is installed)
export { GlobalErrorFilter } from "./nestjs/error-filter";
export { ErrorHandler } from "./nestjs/error-handler";
