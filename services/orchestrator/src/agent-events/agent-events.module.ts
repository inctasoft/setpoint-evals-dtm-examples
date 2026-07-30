import { Module } from '@nestjs/common';
import { AgentEventsController } from './agent-events.controller';
import { AgentForestService } from './agent-forest.service';

/**
 * Agent-events module — the agent-event/1 ingest plane (HTTP POST → forest
 * merge → WS relay). EventsGateway comes from the @Global WebSocketModule, so
 * no import is needed here. Deliberately NOT wired into event-bus/ or
 * transport/ — this plane is separate from the ZMQ internal orchestrator bus.
 */
@Module({
  controllers: [AgentEventsController],
  providers: [AgentForestService],
  exports: [AgentForestService],
})
export class AgentEventsModule {}
