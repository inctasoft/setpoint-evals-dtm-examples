import { Injectable, NestMiddleware } from "@nestjs/common";
import { Request, Response, NextFunction } from "express";
import { CorrelationService } from "../correlation/correlation.service";

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  constructor(private readonly correlationService: CorrelationService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const correlationIdHeader = req.headers["x-correlation-id"];
    const correlationId = Array.isArray(correlationIdHeader)
      ? correlationIdHeader[0]
      : correlationIdHeader;

    this.correlationService.runWithCorrelationId(() => {
      const id = this.correlationService.getCorrelationId();
      if (id) {
        res.setHeader("X-Correlation-ID", id);
        // Also attach to request for easier access in controllers/filters if needed
        (req as any).correlationId = id;
      }
      next();
    }, correlationId);
  }
}
