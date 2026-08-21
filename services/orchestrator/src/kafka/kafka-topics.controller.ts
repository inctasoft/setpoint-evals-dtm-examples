import { Controller, Get, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Kafka, Admin } from 'kafkajs';

export interface KafkaTopicSummary {
  name: string;
  partitions: number;
  /**
   * Sum over all partitions of (highWatermark - lowWatermark) — the number of
   * messages currently retained on the topic (not a lifetime publish count;
   * Kafka doesn't track that without consuming). "cheap" per the task brief:
   * two admin RPCs (fetchTopicMetadata, fetchTopicOffsets), no message
   * consumption.
   */
  approxMessageCount: number;
}

/**
 * Kafka Topics Controller — backs the monitor's "Kafka Topics" tab.
 *
 * Read-only, admin-client only (fetchTopicMetadata + fetchTopicOffsets watermark
 * diff) — never subscribes/consumes, so it can never steal messages from a real
 * consumer group. Gracefully degrades to an empty list (not a 500) when
 * KAFKA_BROKER is unset or the broker is unreachable, mirroring KafkaService's
 * own graceful-degradation contract (see kafka.service.ts).
 */
@ApiTags('kafka')
@Controller('kafka')
export class KafkaTopicsController {
  private readonly logger = new Logger(KafkaTopicsController.name);

  constructor(private readonly configService: ConfigService) {}

  @Get('topics')
  @ApiOperation({
    summary: 'List Kafka topics with a cheap approximate message count',
    description:
      "Lists non-internal topics visible to the admin client, with each topic's partition " +
      'count and an approximate retained-message count (sum of high-low watermark per partition). ' +
      'Returns an empty list (not an error) when Kafka is unreachable.',
  })
  @ApiResponse({ status: 200, description: 'Kafka topics' })
  async listTopics(): Promise<{ topics: KafkaTopicSummary[]; connected: boolean }> {
    const broker = this.configService.get<string>('kafka.broker');
    if (!broker) {
      this.logger.warn('Kafka broker not configured - kafka topics tab disabled');
      return { topics: [], connected: false };
    }

    const kafka = new Kafka({
      clientId: 'dtm-monitor-kafka-topics',
      brokers: broker.split(','),
      retry: { retries: 1, initialRetryTime: 100 },
    });
    const admin: Admin = kafka.admin();

    try {
      await admin.connect();

      const allTopics = (await admin.listTopics()).filter((t) => !t.startsWith('__'));
      if (allTopics.length === 0) {
        return { topics: [], connected: true };
      }

      const metadata = await admin.fetchTopicMetadata({ topics: allTopics });

      // kafkajs's fetchTopicOffsets is per-topic — fetch each topic's watermarks
      // in parallel (still cheap: N small admin RPCs, no message consumption).
      const topics: KafkaTopicSummary[] = await Promise.all(
        metadata.topics.map(async (topicMeta) => {
          let approxMessageCount = 0;
          try {
            const topicOffsets = await admin.fetchTopicOffsets(topicMeta.name);
            approxMessageCount = topicOffsets.reduce((sum, po) => {
              const high = Number(po.high);
              const low = Number(po.low);
              return sum + (Number.isFinite(high) && Number.isFinite(low) ? high - low : 0);
            }, 0);
          } catch (err) {
            this.logger.debug(
              `Could not fetch offsets for topic '${topicMeta.name}': ${
                err instanceof Error ? err.message : 'unknown error'
              }`,
            );
          }
          return {
            name: topicMeta.name,
            partitions: topicMeta.partitions.length,
            approxMessageCount,
          };
        }),
      );

      topics.sort((a, b) => a.name.localeCompare(b.name));

      return { topics, connected: true };
    } catch (error) {
      this.logger.warn(
        `Kafka topics listing failed (broker unreachable?): ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return { topics: [], connected: false };
    } finally {
      try {
        await admin.disconnect();
      } catch {
        // already gone
      }
    }
  }
}
