import {
  simulateWork,
  simulateFailure,
  getSimulatedDelays,
} from "../simulation";

describe("Lambda Worker Utils - Simulation", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment before each test
    process.env = { ...originalEnv };
    jest.clearAllMocks();
    jest.spyOn(console, "log").mockImplementation();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("simulateWork", () => {
    it("should apply delay when ENABLE_REQUESTS_FOR_SIMULATED_DELAYS is true", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";
      const startTime = Date.now();

      await simulateWork(50, "TestStep");

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small margin
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("Simulating work for 50ms"),
      );
    });

    it("should NOT apply delay when ENABLE_REQUESTS_FOR_SIMULATED_DELAYS is false", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "false";
      const startTime = Date.now();

      await simulateWork(100, "TestStep");

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(50); // Should complete almost instantly
    });

    it("should log warning when delay requested but simulation disabled", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "false";

      await simulateWork(100, "TestStep");

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          "Simulated delay requested (100ms) but ENABLE_REQUESTS_FOR_SIMULATED_DELAYS is not enabled",
        ),
      );
    });

    it("should do nothing when delayMs is undefined", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await simulateWork(undefined, "TestStep");

      expect(console.log).not.toHaveBeenCalled();
    });

    it("should do nothing when delayMs is 0", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await simulateWork(0, "TestStep");

      expect(console.log).not.toHaveBeenCalled();
    });

    it("should do nothing when delayMs is negative", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await simulateWork(-10, "TestStep");

      expect(console.log).not.toHaveBeenCalled();
    });

    it("should include step name in logs", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await simulateWork(10, "MyCustomStep");

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining("[MyCustomStep]"),
      );
    });
  });

  describe("simulateFailure", () => {
    it("should throw error when failureAfterMs is set and simulation enabled", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await expect(
        simulateFailure(10, undefined, 1, "TestStep"),
      ).rejects.toThrow("SIMULATED FAILURE [Attempt 1/3]: TestStep");
    });

    it("should NOT throw when simulation is disabled", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "false";

      await expect(
        simulateFailure(10, undefined, 1, "TestStep"),
      ).resolves.not.toThrow();
    });

    it("should fail on specific attempts when failOnAttempts is provided", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      // Should fail on attempt 1
      await expect(
        simulateFailure(10, [1, 2], 1, "TestStep"),
      ).rejects.toThrow();

      // Should fail on attempt 2
      await expect(
        simulateFailure(10, [1, 2], 2, "TestStep"),
      ).rejects.toThrow();

      // Should NOT fail on attempt 3
      await expect(
        simulateFailure(10, [1, 2], 3, "TestStep"),
      ).resolves.not.toThrow();
    });

    it("should log skip message when not in failOnAttempts list", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await simulateFailure(10, [1, 2], 3, "TestStep");

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining(
          "Skipping simulated failure (not in failOnAttempts",
        ),
      );
    });

    it("should do nothing when failureAfterMs is undefined", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await expect(
        simulateFailure(undefined, undefined, 1, "TestStep"),
      ).resolves.not.toThrow();
    });

    it("should do nothing when failureAfterMs is 0", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await expect(
        simulateFailure(0, undefined, 1, "TestStep"),
      ).resolves.not.toThrow();
    });

    it("should do nothing when failureAfterMs is negative", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await expect(
        simulateFailure(-10, undefined, 1, "TestStep"),
      ).resolves.not.toThrow();
    });

    it("should wait before throwing error", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";
      const startTime = Date.now();

      try {
        await simulateFailure(50, undefined, 1, "TestStep");
      } catch (error) {
        const elapsed = Date.now() - startTime;
        expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small margin
      }
    });

    it("should include attempt number in error message", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await expect(
        simulateFailure(10, undefined, 2, "TestStep"),
      ).rejects.toThrow("SIMULATED FAILURE [Attempt 2/3]: TestStep");
    });

    it("should include step name in error message", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await expect(
        simulateFailure(10, undefined, 1, "MyCustomStep"),
      ).rejects.toThrow("SIMULATED FAILURE [Attempt 1/3]: MyCustomStep");
    });

    it("should fail on all attempts when failOnAttempts is undefined", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      await expect(
        simulateFailure(10, undefined, 1, "TestStep"),
      ).rejects.toThrow();
      await expect(
        simulateFailure(10, undefined, 2, "TestStep"),
      ).rejects.toThrow();
      await expect(
        simulateFailure(10, undefined, 3, "TestStep"),
      ).rejects.toThrow();
    });

    it("should NOT fail when failOnAttempts is empty array", async () => {
      process.env.ENABLE_REQUESTS_FOR_SIMULATED_DELAYS = "true";

      // Empty array means no specific attempts to fail on, so check is skipped
      // But since length is 0, the if condition `failOnAttempts.length > 0` is false
      // So it skips the check and falls through to throw
      await expect(simulateFailure(10, [], 1, "TestStep")).rejects.toThrow();
    });
  });

  describe("getSimulatedDelays", () => {
    it("should extract simulatedDelays from input.testOptions", () => {
      const input = {
        testOptions: {
          ValidateCustomer: 1000,
          SubmitCustomer: 500,
        },
        otherField: "value",
      };

      const result = getSimulatedDelays(input);

      expect(result).toEqual({
        ValidateCustomer: 1000,
        SubmitCustomer: 500,
      });
    });

    it("should return undefined when testOptions is not present", () => {
      const input = {
        otherField: "value",
      };

      const result = getSimulatedDelays(input);

      expect(result).toBeUndefined();
    });

    it("should handle null testOptions", () => {
      const input = {
        testOptions: null,
        otherField: "value",
      };

      const result = getSimulatedDelays(input);

      expect(result).toBeNull();
    });

    it("should handle empty testOptions object", () => {
      const input = {
        testOptions: {},
      };

      const result = getSimulatedDelays(input);

      expect(result).toEqual({});
    });
  });
});
