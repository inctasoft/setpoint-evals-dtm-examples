import axios from "axios";
import { sendSuccessCallback, sendFailureCallback } from "../callbacks";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Lambda Worker Utils - Callbacks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation();
    jest.spyOn(console, "error").mockImplementation();
  });

  describe("sendSuccessCallback", () => {
    const defaultParams = {
      callbackUrl: "http://orchestrator:3000/callback",
      jobId: "job-123",
      stepId: "step-456",
      output: { data: "test" },
      recordsProcessed: 5,
      retryMetadata: {
        sqsMessageId: "msg-789",
        sqsReceiveCount: 1,
        processingTimeMs: 1234,
      },
      stepName: "TestStep",
    };

    it("should send success callback with correct payload", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendSuccessCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.output,
        defaultParams.recordsProcessed,
        defaultParams.retryMetadata,
        defaultParams.stepName,
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        defaultParams.callbackUrl,
        {
          jobId: defaultParams.jobId,
          stepId: defaultParams.stepId,
          status: "completed",
          recordsProcessed: defaultParams.recordsProcessed,
          output: defaultParams.output,
          retryMetadata: {
            ...defaultParams.retryMetadata,
            isRetry: false,
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );
    });

    it("should mark isRetry as false when sqsReceiveCount is 1", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendSuccessCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.output,
        defaultParams.recordsProcessed,
        { ...defaultParams.retryMetadata, sqsReceiveCount: 1 },
        defaultParams.stepName,
      );

      const payload = mockedAxios.post.mock.calls[0][1] as any;
      expect(payload.retryMetadata.isRetry).toBe(false);
    });

    it("should mark isRetry as true when sqsReceiveCount is greater than 1", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendSuccessCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.output,
        defaultParams.recordsProcessed,
        { ...defaultParams.retryMetadata, sqsReceiveCount: 3 },
        defaultParams.stepName,
      );

      const payload = mockedAxios.post.mock.calls[0][1] as any;
      expect(payload.retryMetadata.isRetry).toBe(true);
    });

    it("should include step name in log messages", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendSuccessCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.output,
        defaultParams.recordsProcessed,
        defaultParams.retryMetadata,
        "MyCustomStep",
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("[MyCustomStep]"),
      );
    });

    it("should handle axios request errors gracefully", async () => {
      mockedAxios.post.mockRejectedValue(new Error("Network error"));

      await expect(
        sendSuccessCallback(
          defaultParams.callbackUrl,
          defaultParams.jobId,
          defaultParams.stepId,
          defaultParams.output,
          defaultParams.recordsProcessed,
          defaultParams.retryMetadata,
          defaultParams.stepName,
        ),
      ).rejects.toThrow("Callback failed: Network error");

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Callback failed"),
        expect.any(Error),
      );
    });

    it("should handle non-Error exceptions", async () => {
      mockedAxios.post.mockRejectedValue("String error");

      await expect(
        sendSuccessCallback(
          defaultParams.callbackUrl,
          defaultParams.jobId,
          defaultParams.stepId,
          defaultParams.output,
          defaultParams.recordsProcessed,
          defaultParams.retryMetadata,
          defaultParams.stepName,
        ),
      ).rejects.toThrow("Callback failed: Unknown error");
    });

    it("should use correct timeout", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendSuccessCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.output,
        defaultParams.recordsProcessed,
        defaultParams.retryMetadata,
        defaultParams.stepName,
      );

      const config = mockedAxios.post.mock.calls[0][2];
      expect(config?.timeout).toBe(10000);
    });

    it("should handle different output types", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      // Test with complex output
      const complexOutput = {
        consumer: { id: 1, name: "Test" },
        metadata: { timestamp: "2024-01-01" },
      };

      await sendSuccessCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        complexOutput,
        defaultParams.recordsProcessed,
        defaultParams.retryMetadata,
        defaultParams.stepName,
      );

      const payload = mockedAxios.post.mock.calls[0][1] as any;
      expect(payload.output).toEqual(complexOutput);
    });
  });

  describe("sendFailureCallback", () => {
    const defaultParams = {
      callbackUrl: "http://orchestrator:3000/callback",
      jobId: "job-123",
      stepId: "step-456",
      error: new Error("Test error"),
      retryMetadata: {
        sqsMessageId: "msg-789",
        sqsReceiveCount: 1,
        processingTimeMs: 1234,
      },
      stepName: "TestStep",
    };

    it("should send failure callback with correct payload", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendFailureCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.error,
        defaultParams.retryMetadata,
        defaultParams.stepName,
      );

      expect(mockedAxios.post).toHaveBeenCalledWith(
        defaultParams.callbackUrl,
        {
          jobId: defaultParams.jobId,
          stepId: defaultParams.stepId,
          status: "failed",
          recordsProcessed: 0,
          error: "Test error",
          retryMetadata: {
            ...defaultParams.retryMetadata,
            isRetry: false,
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        },
      );
    });

    it("should extract error message from Error object", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendFailureCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        new Error("Custom error message"),
        defaultParams.retryMetadata,
        defaultParams.stepName,
      );

      const payload = mockedAxios.post.mock.calls[0][1] as any;
      expect(payload.error).toBe("Custom error message");
    });

    it("should mark isRetry correctly based on sqsReceiveCount", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      // Test with first attempt
      await sendFailureCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.error,
        { ...defaultParams.retryMetadata, sqsReceiveCount: 1 },
        defaultParams.stepName,
      );

      let payload = mockedAxios.post.mock.calls[0][1] as any;
      expect(payload.retryMetadata.isRetry).toBe(false);

      // Test with retry attempt
      await sendFailureCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.error,
        { ...defaultParams.retryMetadata, sqsReceiveCount: 2 },
        defaultParams.stepName,
      );

      payload = mockedAxios.post.mock.calls[1][1] as any;
      expect(payload.retryMetadata.isRetry).toBe(true);
    });

    it("should NOT throw when callback itself fails", async () => {
      mockedAxios.post.mockRejectedValue(new Error("Callback network error"));

      // Should not throw - just log error
      await expect(
        sendFailureCallback(
          defaultParams.callbackUrl,
          defaultParams.jobId,
          defaultParams.stepId,
          defaultParams.error,
          defaultParams.retryMetadata,
          defaultParams.stepName,
        ),
      ).resolves.not.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Failure callback also failed"),
        expect.any(Error),
      );
    });

    it("should include step name in log messages", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendFailureCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.error,
        defaultParams.retryMetadata,
        "MyCustomStep",
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("[MyCustomStep]"),
      );
    });

    it("should include attempt number in log messages", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendFailureCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.error,
        { ...defaultParams.retryMetadata, sqsReceiveCount: 3 },
        defaultParams.stepName,
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("attempt 3"),
      );
    });

    it("should always set recordsProcessed to 0", async () => {
      mockedAxios.post.mockResolvedValue({ status: 200, data: {} });

      await sendFailureCallback(
        defaultParams.callbackUrl,
        defaultParams.jobId,
        defaultParams.stepId,
        defaultParams.error,
        defaultParams.retryMetadata,
        defaultParams.stepName,
      );

      const payload = mockedAxios.post.mock.calls[0][1] as any;
      expect(payload.recordsProcessed).toBe(0);
    });
  });
});
