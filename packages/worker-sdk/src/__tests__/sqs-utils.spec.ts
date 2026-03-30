import { SQSRecord } from "aws-lambda";
import {
  getSQSMessageAttributes,
  createBatchItemFailure,
  buildRetryMetadata,
} from "../sqs-utils";

describe("Lambda Worker Utils - SQS Utils", () => {
  describe("getSQSMessageAttributes", () => {
    it("should extract receive count and message ID from SQS record", () => {
      const record: Partial<SQSRecord> = {
        messageId: "msg-123",
        attributes: {
          ApproximateReceiveCount: "3",
        } as any,
      };

      const result = getSQSMessageAttributes(record as SQSRecord);

      expect(result).toEqual({
        receiveCount: 3,
        messageId: "msg-123",
      });
    });

    it("should default to receive count 1 when attribute is missing", () => {
      const record: Partial<SQSRecord> = {
        messageId: "msg-123",
        attributes: {} as any,
      };

      const result = getSQSMessageAttributes(record as SQSRecord);

      expect(result.receiveCount).toBe(1);
    });

    it('should handle receive count as string "1"', () => {
      const record: Partial<SQSRecord> = {
        messageId: "msg-123",
        attributes: {
          ApproximateReceiveCount: "1",
        } as any,
      };

      const result = getSQSMessageAttributes(record as SQSRecord);

      expect(result.receiveCount).toBe(1);
    });

    it("should handle large receive counts", () => {
      const record: Partial<SQSRecord> = {
        messageId: "msg-123",
        attributes: {
          ApproximateReceiveCount: "999",
        } as any,
      };

      const result = getSQSMessageAttributes(record as SQSRecord);

      expect(result.receiveCount).toBe(999);
    });

    it("should handle missing attributes object", () => {
      const record: Partial<SQSRecord> = {
        messageId: "msg-123",
      };

      const result = getSQSMessageAttributes(record as SQSRecord);

      expect(result).toEqual({
        receiveCount: 1,
        messageId: "msg-123",
      });
    });

    it("should preserve message ID exactly as provided", () => {
      const messageId = "very-long-uuid-1234-5678-abcd";
      const record: Partial<SQSRecord> = {
        messageId,
        attributes: {
          ApproximateReceiveCount: "1",
        } as any,
      };

      const result = getSQSMessageAttributes(record as SQSRecord);

      expect(result.messageId).toBe(messageId);
    });
  });

  describe("createBatchItemFailure", () => {
    it("should create batch item failure with correct format", () => {
      const messageId = "msg-123";

      const result = createBatchItemFailure(messageId);

      expect(result).toEqual({
        itemIdentifier: "msg-123",
      });
    });

    it("should handle different message ID formats", () => {
      const messageIds = [
        "simple-id",
        "uuid-1234-5678-abcd-efgh",
        "12345",
        "msg_with_underscore",
      ];

      messageIds.forEach((messageId) => {
        const result = createBatchItemFailure(messageId);
        expect(result.itemIdentifier).toBe(messageId);
      });
    });

    it("should create unique objects for different message IDs", () => {
      const failure1 = createBatchItemFailure("msg-1");
      const failure2 = createBatchItemFailure("msg-2");

      expect(failure1).not.toEqual(failure2);
      expect(failure1.itemIdentifier).toBe("msg-1");
      expect(failure2.itemIdentifier).toBe("msg-2");
    });
  });

  describe("buildRetryMetadata", () => {
    it("should build retry metadata from SQS attributes and processing time", () => {
      const sqsAttributes = {
        receiveCount: 2,
        messageId: "msg-123",
      };
      const processingStartTime = Date.now() - 5000; // 5 seconds ago

      const result = buildRetryMetadata(sqsAttributes, processingStartTime);

      expect(result.sqsMessageId).toBe("msg-123");
      expect(result.sqsReceiveCount).toBe(2);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(4900); // Allow small margin
      expect(result.processingTimeMs).toBeLessThanOrEqual(5100);
    });

    it("should calculate processing time correctly", () => {
      const sqsAttributes = {
        receiveCount: 1,
        messageId: "msg-123",
      };
      const processingStartTime = Date.now() - 1234; // 1.234 seconds ago

      const result = buildRetryMetadata(sqsAttributes, processingStartTime);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(1200);
      expect(result.processingTimeMs).toBeLessThanOrEqual(1300);
    });

    it("should handle first attempt (receiveCount = 1)", () => {
      const sqsAttributes = {
        receiveCount: 1,
        messageId: "msg-123",
      };
      const processingStartTime = Date.now();

      const result = buildRetryMetadata(sqsAttributes, processingStartTime);

      expect(result.sqsReceiveCount).toBe(1);
    });

    it("should handle retry attempts (receiveCount > 1)", () => {
      const sqsAttributes = {
        receiveCount: 3,
        messageId: "msg-123",
      };
      const processingStartTime = Date.now();

      const result = buildRetryMetadata(sqsAttributes, processingStartTime);

      expect(result.sqsReceiveCount).toBe(3);
    });

    it("should handle very fast processing (< 1ms)", () => {
      const sqsAttributes = {
        receiveCount: 1,
        messageId: "msg-123",
      };
      const processingStartTime = Date.now();

      const result = buildRetryMetadata(sqsAttributes, processingStartTime);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.processingTimeMs).toBeLessThan(10);
    });

    it("should handle long processing times", () => {
      const sqsAttributes = {
        receiveCount: 1,
        messageId: "msg-123",
      };
      const processingStartTime = Date.now() - 30000; // 30 seconds ago

      const result = buildRetryMetadata(sqsAttributes, processingStartTime);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(29900);
      expect(result.processingTimeMs).toBeLessThanOrEqual(30100);
    });

    it("should preserve message ID exactly", () => {
      const messageId = "complex-uuid-with-dashes-1234-5678";
      const sqsAttributes = {
        receiveCount: 1,
        messageId,
      };
      const processingStartTime = Date.now();

      const result = buildRetryMetadata(sqsAttributes, processingStartTime);

      expect(result.sqsMessageId).toBe(messageId);
    });

    it("should create independent metadata objects", () => {
      const sqsAttributes1 = {
        receiveCount: 1,
        messageId: "msg-1",
      };
      const sqsAttributes2 = {
        receiveCount: 2,
        messageId: "msg-2",
      };
      const processingStartTime = Date.now();

      const result1 = buildRetryMetadata(sqsAttributes1, processingStartTime);
      const result2 = buildRetryMetadata(sqsAttributes2, processingStartTime);

      expect(result1.sqsMessageId).toBe("msg-1");
      expect(result2.sqsMessageId).toBe("msg-2");
      expect(result1.sqsReceiveCount).toBe(1);
      expect(result2.sqsReceiveCount).toBe(2);
    });
  });
});
