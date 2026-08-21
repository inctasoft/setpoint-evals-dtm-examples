export class WorkerLogger {
  private correlationId: string | undefined;
  private context: string | undefined;

  constructor(correlationId?: string, context?: string) {
    this.correlationId = correlationId;
    this.context = context;
  }

  setCorrelationId(id: string) {
    this.correlationId = id;
  }

  setContext(context: string) {
    this.context = context;
  }

  log(message: string, ...args: any[]) {
    console.log(this.formatMessage("INFO", message, ...args));
  }

  info(message: string, ...args: any[]) {
    console.info(this.formatMessage("INFO", message, ...args));
  }

  error(message: string, ...args: any[]) {
    console.error(this.formatMessage("ERROR", message, ...args));
  }

  warn(message: string, ...args: any[]) {
    console.warn(this.formatMessage("WARN", message, ...args));
  }

  debug(message: string, ...args: any[]) {
    console.debug(this.formatMessage("DEBUG", message, ...args));
  }

  private formatMessage(
    level: string,
    message: string,
    ...args: any[]
  ): string {
    const prefix = this.correlationId ? `[${this.correlationId}]` : "";
    const contextPrefix = this.context ? `[${this.context}]` : "";

    // Handle args if they exist
    const argsStr =
      args.length > 0
        ? args
            .map((arg) => {
              if (arg instanceof Error) {
                return `${arg.message}${arg.stack ? "\n" + arg.stack : ""}`;
              }
              return typeof arg === "object"
                ? JSON.stringify(arg)
                : String(arg);
            })
            .join(" ")
        : "";

    return `${prefix}${contextPrefix} ${message} ${argsStr}`.trim();
  }
}

export const createLogger = (correlationId?: string, context?: string) =>
  new WorkerLogger(correlationId, context);
