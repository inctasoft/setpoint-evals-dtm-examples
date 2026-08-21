import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZmqWorkerRegistryService, ZmqWorkerRecord } from './zmq-worker-registry.service';

/**
 * Zmq worker fleet introspection (zmq task transport only — this controller
 * is registered by TransportModule solely under QUEUE_TRANSPORT=zmq).
 * The monitor dashboard consumes this in Phase 4; setpoint evals use it to
 * assert registration, heartbeat-loss, and re-registration behavior.
 */
@ApiTags('workers')
@Controller('workers')
export class ZmqWorkersController {
  constructor(private readonly registry: ZmqWorkerRegistryService) {}

  @Get()
  @ApiOperation({
    summary: 'List registered zmq workers',
    description:
      'Snapshot of the DEALER worker fleet: workerId, queues served, alive/dead state (heartbeat silence), registration and last-heartbeat timestamps.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current worker fleet snapshot (empty when no worker has HELLOed yet)',
  })
  listWorkers(): ZmqWorkerRecord[] {
    return this.registry.listWorkers();
  }
}
