export interface KafkaConsumerConfig {
  broker: string;
  groupId: string;
  clientId?: string;
  topics?: string[]; // Optional: topics to subscribe to on init
}

export interface TopicSubscription {
  topic: string;
  fromBeginning?: boolean;
}
