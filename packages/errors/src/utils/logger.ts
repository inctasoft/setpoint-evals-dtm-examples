/**
 * Logger interface for framework-agnostic error handling
 * Implement this interface to use your framework's logger
 */
export interface ILogger {
  log(message: string, context?: string): void;
  error(message: string, trace?: string, context?: string): void;
  warn(message: string, context?: string): void;
  debug?(message: string, context?: string): void;
  verbose?(message: string, context?: string): void;
}

/**
 * Console logger implementation (fallback)
 */
export class ConsoleLogger implements ILogger {
  log(message: string, context?: string): void {
    console.log(`[${context || "App"}] ${message}`);
  }

  error(message: string, trace?: string, context?: string): void {
    console.error(`[${context || "App"}] ${message}`);
    if (trace) {
      console.error(trace);
    }
  }

  warn(message: string, context?: string): void {
    console.warn(`[${context || "App"}] ${message}`);
  }

  debug(message: string, context?: string): void {
    console.debug(`[${context || "App"}] ${message}`);
  }

  verbose(message: string, context?: string): void {
    console.log(`[${context || "App"}][VERBOSE] ${message}`);
  }
}
