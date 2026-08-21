import { createLogger, WorkerLogger } from "../logger";

describe("WorkerLogger", () => {
  let consoleLogSpy: jest.SpyInstance;
  let consoleInfoSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleDebugSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, "log").mockImplementation();
    consoleInfoSpy = jest.spyOn(console, "info").mockImplementation();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
    consoleWarnSpy = jest.spyOn(console, "warn").mockImplementation();
    consoleDebugSpy = jest.spyOn(console, "debug").mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should create logger with correlation ID and context", () => {
    const logger = createLogger("123", "TestContext");
    logger.log("test message");
    expect(consoleLogSpy).toHaveBeenCalledWith(
      "[123][TestContext] test message",
    );
  });

  it("should format message correctly without correlation ID", () => {
    const logger = createLogger(undefined, "TestContext");
    logger.log("test message");
    expect(consoleLogSpy).toHaveBeenCalledWith("[TestContext] test message");
  });

  it("should format message correctly without context", () => {
    const logger = createLogger("123");
    logger.log("test message");
    expect(consoleLogSpy).toHaveBeenCalledWith("[123] test message");
  });

  it("should handle objects in args", () => {
    const logger = createLogger("123");
    logger.log("test message", { foo: "bar" });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      '[123] test message {"foo":"bar"}',
    );
  });

  it("should call appropriate console methods", () => {
    const logger = createLogger("123");

    logger.info("info msg");
    expect(consoleInfoSpy).toHaveBeenCalledWith("[123] info msg");

    logger.error("error msg");
    expect(consoleErrorSpy).toHaveBeenCalledWith("[123] error msg");

    logger.warn("warn msg");
    expect(consoleWarnSpy).toHaveBeenCalledWith("[123] warn msg");

    logger.debug("debug msg");
    expect(consoleDebugSpy).toHaveBeenCalledWith("[123] debug msg");
  });

  it("should allow updating correlation ID and context", () => {
    const logger = createLogger();
    logger.setCorrelationId("456");
    logger.setContext("NewContext");
    logger.log("test");
    expect(consoleLogSpy).toHaveBeenCalledWith("[456][NewContext] test");
  });
});
