import { ConsoleLogger, Injectable } from '@nestjs/common';
import { CorrelationService } from '../correlation/correlation.service';

@Injectable()
export class AppLogger extends ConsoleLogger {
  private readonly isJsonFormat: boolean;

  constructor(private readonly correlationService: CorrelationService) {
    super();
    this.isJsonFormat = process.env.LOG_FORMAT === 'json';
  }

  formatContext(context: string): string {
    const correlationId = this.correlationService.getCorrelationId();
    const contextStr = super.formatContext(context);
    if (correlationId) {
      return `[${correlationId}] ${contextStr}`;
    }
    return contextStr;
  }

  private printJson(level: string, message: unknown, context?: string, stack?: string) {
    const correlationId = this.correlationService.getCorrelationId();
    const logObject = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      correlationId,
      ...(stack && { stack }),
    };
    process.stdout.write(JSON.stringify(logObject) + '\n');
  }

  log(message: unknown, context?: string) {
    if (this.isJsonFormat) {
      this.printJson('INFO', message, context);
      return;
    }
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.log(message, context ? `[${correlationId}] ${context}` : `[${correlationId}]`);
    } else {
      super.log(message, context);
    }
  }

  error(message: unknown, stack?: string, context?: string) {
    if (this.isJsonFormat) {
      this.printJson('ERROR', message, context, stack);
      return;
    }
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.error(message, stack, context ? `[${correlationId}] ${context}` : `[${correlationId}]`);
    } else {
      super.error(message, stack, context);
    }
  }

  warn(message: unknown, context?: string) {
    if (this.isJsonFormat) {
      this.printJson('WARN', message, context);
      return;
    }
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.warn(message, context ? `[${correlationId}] ${context}` : `[${correlationId}]`);
    } else {
      super.warn(message, context);
    }
  }

  debug(message: unknown, context?: string) {
    if (this.isJsonFormat) {
      this.printJson('DEBUG', message, context);
      return;
    }
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.debug(message, context ? `[${correlationId}] ${context}` : `[${correlationId}]`);
    } else {
      super.debug(message, context);
    }
  }

  verbose(message: unknown, context?: string) {
    if (this.isJsonFormat) {
      this.printJson('VERBOSE', message, context);
      return;
    }
    const correlationId = this.correlationService.getCorrelationId();
    if (correlationId) {
      super.verbose(message, context ? `[${correlationId}] ${context}` : `[${correlationId}]`);
    } else {
      super.verbose(message, context);
    }
  }
}
