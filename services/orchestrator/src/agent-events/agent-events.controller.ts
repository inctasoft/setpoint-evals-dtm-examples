import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AgentEvent } from '@dtm/core';
import { AgentForestService } from './agent-forest.service';
import { validateAgentEvent } from './agent-event.guards';

/**
 * Agent Events Controller
 * HTTP ingest for the agent-event/1 plane (Phase C). Separate from the ZMQ
 * internal orchestrator bus — this plane carries agent-tree lifecycle events,
 * not workflow tasks.
 */
@ApiTags('agent-events')
@Controller('agent-events')
export class AgentEventsController {
  private readonly logger = new Logger(AgentEventsController.name);

  constructor(private readonly agentForestService: AgentForestService) {}

  /**
   * Ingest one or more agent-event/1 lifecycle events.
   * Accepts a single event object OR an array (both shapes valid). Every record
   * is validated fail-closed BEFORE any merge — the first invalid record
   * rejects the whole batch (never partially ingest an invalid batch).
   *
   * POST /api/v1/agent-events
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ingest agent-event/1 lifecycle events',
    description:
      'Accepts a single agent-event/1 object or an array. Each record is validated ' +
      'against the canonical schema (fail-closed on structure, fail-open on taxonomy); ' +
      'the first invalid record rejects the entire batch.',
  })
  @ApiResponse({ status: 200, description: 'Events accepted' })
  @ApiResponse({ status: 400, description: 'Invalid agent-event/1 record — batch rejected' })
  ingestEvents(@Body() body: unknown): { accepted: number } {
    const records: unknown[] = Array.isArray(body) ? body : [body];

    const events: AgentEvent[] = [];
    for (const record of records) {
      const result = validateAgentEvent(record);
      if (!result.ok) {
        this.logger.warn(`Rejected agent-event batch: ${result.error}`);
        throw new BadRequestException(result.error);
      }
      events.push(result.event);
    }

    this.agentForestService.ingest(events);
    return { accepted: events.length };
  }
}
