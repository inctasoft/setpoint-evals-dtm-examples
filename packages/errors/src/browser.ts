// Browser-safe exports (excludes NestJS-specific code)

// Core (framework-agnostic)
export { ErrorCode } from "./core/error-codes";
export { AppError } from "./core/base-error";

// HTTP errors (for APIs and browser)
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

// Note: NestJS adapters (GlobalErrorFilter, ErrorHandler) are NOT exported here
// as they require Node.js globals (process) and @nestjs/common
// For NestJS code, import from '@dtm/errors' directly
