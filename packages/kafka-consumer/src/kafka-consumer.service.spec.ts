import { Test, TestingModule } from "@nestjs/testing";
import { KafkaConsumerService } from "./kafka-consumer.service";
import { IMessageHandler } from "./interfaces/message-handler.interface";
import { EachMessagePayload } from "kafkajs";

describe("KafkaConsumerService", () => {
  let service: KafkaConsumerService;
  let mockHandler: jest.Mocked<IMessageHandler>;

  beforeEach(() => {
    // Mock handler
    mockHandler = {
      handleMessage: jest.fn().mockResolvedValue(undefined),
    };
  });

  describe("Graceful Degradation (No Broker)", () => {
    beforeEach(() => {
      service = new KafkaConsumerService({
        broker: "", // Empty broker
        groupId: "test-group",
      });
    });

    it("should be defined", () => {
      expect(service).toBeDefined();
    });

    it("should not be connected without broker", () => {
      expect(service.isConsumerConnected()).toBe(false);
    });

    it("should handle connect() gracefully without broker", async () => {
      await service.connect();
      expect(service.isConsumerConnected()).toBe(false);
    });

    it("should register handler even without connection", () => {
      expect(() => {
        service.registerHandler("test.topic", mockHandler);
      }).not.toThrow();
    });

    it("should skip subscription without connection", async () => {
      await expect(
        service.subscribe({ topic: "test.topic", fromBeginning: false }),
      ).resolves.not.toThrow();
    });

    it("should skip start consuming without connection", async () => {
      await expect(service.startConsuming()).resolves.not.toThrow();
    });

    it("should handle disconnect gracefully", async () => {
      await expect(service.disconnect()).resolves.not.toThrow();
    });
  });

  describe("Handler Registration (Offline)", () => {
    beforeEach(() => {
      service = new KafkaConsumerService({
        broker: "",
        groupId: "test-group",
      });
    });

    it("should register a handler", () => {
      service.registerHandler("test.topic", mockHandler);
      // No error means success
    });

    it("should register multiple handlers for different topics", () => {
      const handler1 = { handleMessage: jest.fn() };
      const handler2 = { handleMessage: jest.fn() };

      service.registerHandler("topic.one", handler1);
      service.registerHandler("topic.two", handler2);

      // No errors means both registered
    });
  });

  describe("Configuration", () => {
    it("should accept minimal config", () => {
      const minimalService = new KafkaConsumerService({
        broker: "localhost:9092",
        groupId: "test-group",
      });

      expect(minimalService).toBeDefined();
      expect(minimalService.isConsumerConnected()).toBe(false);
    });

    it("should accept full config", () => {
      const fullService = new KafkaConsumerService({
        broker: "localhost:9092",
        groupId: "test-group",
        clientId: "custom-client",
        topics: ["topic1", "topic2"],
      });

      expect(fullService).toBeDefined();
    });
  });

  describe("Connection State", () => {
    beforeEach(() => {
      service = new KafkaConsumerService({
        broker: "",
        groupId: "test-group",
      });
    });

    it("should return false when not connected", () => {
      expect(service.isConsumerConnected()).toBe(false);
    });

    it("should not throw when checking connection state", () => {
      expect(() => service.isConsumerConnected()).not.toThrow();
    });
  });

  describe("Module Lifecycle", () => {
    beforeEach(() => {
      service = new KafkaConsumerService({
        broker: "",
        groupId: "test-group",
      });
    });

    it("should handle onModuleDestroy", async () => {
      await expect(service.onModuleDestroy()).resolves.not.toThrow();
    });

    it("should disconnect on module destroy", async () => {
      const disconnectSpy = jest.spyOn(service, "disconnect");
      await service.onModuleDestroy();
      expect(disconnectSpy).toHaveBeenCalled();
    });
  });

  describe("Error Scenarios", () => {
    it("should handle null/undefined config gracefully", () => {
      expect(() => {
        new KafkaConsumerService({
          broker: undefined as unknown as string,
          groupId: "test",
        });
      }).not.toThrow();
    });

    it("should handle empty group ID", () => {
      expect(() => {
        new KafkaConsumerService({
          broker: "localhost:9092",
          groupId: "",
        });
      }).not.toThrow();
    });
  });
});
