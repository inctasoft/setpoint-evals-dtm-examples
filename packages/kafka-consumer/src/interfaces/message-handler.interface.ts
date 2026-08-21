import { EachMessagePayload } from "kafkajs";

export interface IMessageHandler {
  handleMessage(payload: EachMessagePayload): Promise<void>;
}

export interface TopicHandler {
  topic: string;
  handler: IMessageHandler;
}
