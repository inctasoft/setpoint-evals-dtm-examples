import { SetMetadata } from "@nestjs/common";

export const KAFKA_TOPIC_HANDLER = "kafka_topic_handler";

export interface KafkaTopicOptions {
  topic: string;
  fromBeginning?: boolean;
}

/**
 * Decorator to mark a class as a Kafka topic handler
 * @example
 * @KafkaTopic({ topic: 'dtm.your-workflow.ack' })
 * export class WorkflowAckHandler implements IMessageHandler { ... }
 */
export const KafkaTopic = (options: KafkaTopicOptions) =>
  SetMetadata(KAFKA_TOPIC_HANDLER, options);
