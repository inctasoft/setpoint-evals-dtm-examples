import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "async_hooks";
import { v4 as uuidv4 } from "uuid";

@Injectable()
export class CorrelationService {
  private readonly asyncLocalStorage = new AsyncLocalStorage<string>();

  /**
   * Run a callback within a correlation context
   */
  runWithCorrelationId<T>(callback: () => T, correlationId?: string): T {
    const id = correlationId || uuidv4();
    return this.asyncLocalStorage.run(id, callback);
  }

  /**
   * Get the current correlation ID
   */
  getCorrelationId(): string | undefined {
    return this.asyncLocalStorage.getStore();
  }
}
