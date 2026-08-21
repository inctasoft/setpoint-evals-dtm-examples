import { ConsoleLogger, Injectable } from "@nestjs/common";
import { CorrelationService } from "../correlation/correlation.service";

@Injectable()
export class AppLogger extends ConsoleLogger {
  constructor(private readonly correlationService: CorrelationService) {
    super();
  }

  formatContext(context: string): string {
    const correlationId = this.correlationService.getCorrelationId();
    const contextStr = super.formatContext(context);
    if (correlationId) {
      return `[${correlationId}] ${contextStr}`;
    }
    return contextStr;
  }

  log(message: any, context?: string) {
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.log(
        message,
        context ? `[${correlationId}] ${context}` : `[${correlationId}]`,
      );
    } else {
      super.log(message, context);
    }
  }

  error(message: any, stack?: string, context?: string) {
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.error(
        message,
        stack,
        context ? `[${correlationId}] ${context}` : `[${correlationId}]`,
      );
    } else {
      super.error(message, stack, context);
    }
  }

  warn(message: any, context?: string) {
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.warn(
        message,
        context ? `[${correlationId}] ${context}` : `[${correlationId}]`,
      );
    } else {
      super.warn(message, context);
    }
  }

  debug(message: any, context?: string) {
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.debug(
        message,
        context ? `[${correlationId}] ${context}` : `[${correlationId}]`,
      );
    } else {
      super.debug(message, context);
    }
  }

  verbose(message: any, context?: string) {
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.verbose(
        message,
        context ? `[${correlationId}] ${context}` : `[${correlationId}]`,
      );
    } else {
      super.verbose(message, context);
    }
  }
}
