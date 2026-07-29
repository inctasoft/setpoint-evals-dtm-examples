/**
 * Phase 2 fix — per-workflow isolation of the zmq-worker-host (RED-first).
 *
 * Each host container bind-mounts ONLY its own workflow's packages into
 * /app/node_modules (docker-compose.zmq.yml). The first cut of
 * queue-discovery.ts / handler-registry.ts STATICALLY imported all three
 * workflows' configs / handler maps / DataSources, so every container
 * crash-looped with `Cannot find module '@dtm-workflows/<other-workflow>'`.
 *
 * These specs pin the isolation contract: loading these modules and resolving
 * one workflow must NEVER require a foreign workflow's package. Foreign
 * packages are doMocked to THROW on load — any static import or eager Map of
 * imports turns this suite RED.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- specs require()
 * inside jest.isolateModules so the doMock registry governs resolution. */

const ORDER_CONFIG = "@dtm-workflows/order-processing";
const IOT_CONFIG = "@dtm-workflows/iot-sensor-pipeline";
const INFRA_CONFIG = "@dtm-workflows/infra-provisioning";
const ORDER_WORKERS = "@dtm-workflows/order-processing-workers";
const IOT_WORKERS = "@dtm-workflows/iot-sensor-pipeline-workers";
const INFRA_WORKERS = "@dtm-workflows/infra-provisioning-workers";
const ORDER_TYPEORM = "@dtm-workflows/order-processing-typeorm";
const IOT_TYPEORM = "@dtm-workflows/iot-sensor-pipeline-typeorm";
const INFRA_TYPEORM = "@dtm-workflows/infra-provisioning-typeorm";

function throwOnLoad(label: string) {
  return () => {
    throw new Error(`FOREIGN workflow module loaded: ${label}`);
  };
}

describe("Phase 2 — worker-host per-workflow isolation", () => {
  it("SE-ISO-discovery-load: requiring queue-discovery loads NO workflow package", () => {
    jest.isolateModules(() => {
      jest.doMock(ORDER_CONFIG, throwOnLoad("order-processing"));
      jest.doMock(IOT_CONFIG, throwOnLoad("iot-sensor-pipeline"));
      jest.doMock(INFRA_CONFIG, throwOnLoad("infra-provisioning"));

      const discovery = require("./queue-discovery");
      expect(typeof discovery.discoverQueuesForWorkflow).toBe("function");
    });
  });

  it("SE-ISO-discovery-resolve: discovering one workflow's queues touches only that workflow", () => {
    jest.isolateModules(() => {
      jest.doMock(ORDER_CONFIG, () => ({
        orderProcessingWorkflow: {
          name: "order-processing",
          steps: {
            default: [{ queueName: "order-b" }, { queueName: "order-a" }, {}],
            other: [{ queueName: "order-a" }],
          },
        },
      }));
      jest.doMock(IOT_CONFIG, throwOnLoad("iot-sensor-pipeline"));
      jest.doMock(INFRA_CONFIG, throwOnLoad("infra-provisioning"));

      const { discoverQueuesForWorkflow } = require("./queue-discovery");

      // Unique across variants, sorted — the pre-fix return shape, unchanged.
      expect(discoverQueuesForWorkflow("order-processing")).toEqual([
        "order-a",
        "order-b",
      ]);
    });
  });

  it("SE-ISO-discovery-unknown: an unknown workflow fails fast without loading any package", () => {
    jest.isolateModules(() => {
      jest.doMock(ORDER_CONFIG, throwOnLoad("order-processing"));
      jest.doMock(IOT_CONFIG, throwOnLoad("iot-sensor-pipeline"));
      jest.doMock(INFRA_CONFIG, throwOnLoad("infra-provisioning"));

      const { discoverQueuesForWorkflow } = require("./queue-discovery");

      expect(() => discoverQueuesForWorkflow("nope")).toThrow(
        /Unknown WORKFLOW_NAME 'nope'/,
      );
    });
  });

  it("SE-ISO-registry-load: requiring handler-registry loads NO workflow workers/typeorm package", () => {
    jest.isolateModules(() => {
      jest.doMock(ORDER_WORKERS, throwOnLoad("order-processing-workers"));
      jest.doMock(IOT_WORKERS, throwOnLoad("iot-sensor-pipeline-workers"));
      jest.doMock(INFRA_WORKERS, throwOnLoad("infra-provisioning-workers"));
      jest.doMock(ORDER_TYPEORM, throwOnLoad("order-processing-typeorm"));
      jest.doMock(IOT_TYPEORM, throwOnLoad("iot-sensor-pipeline-typeorm"));
      jest.doMock(INFRA_TYPEORM, throwOnLoad("infra-provisioning-typeorm"));

      const registry = require("./handler-registry");
      expect(typeof registry.getHandlerMapForWorkflow).toBe("function");
      expect(typeof registry.initWorkflowDataSource).toBe("function");
    });
  });

  it("SE-ISO-registry-resolve: the handler map resolution touches only the served workflow", () => {
    jest.isolateModules(() => {
      const fakeHandler = jest.fn();
      jest.doMock(ORDER_WORKERS, () => ({
        handlerMap: { "order-validate-customer": fakeHandler },
      }));
      jest.doMock(IOT_WORKERS, throwOnLoad("iot-sensor-pipeline-workers"));
      jest.doMock(INFRA_WORKERS, throwOnLoad("infra-provisioning-workers"));
      jest.doMock(ORDER_TYPEORM, throwOnLoad("order-processing-typeorm"));
      jest.doMock(IOT_TYPEORM, throwOnLoad("iot-sensor-pipeline-typeorm"));
      jest.doMock(INFRA_TYPEORM, throwOnLoad("infra-provisioning-typeorm"));

      const { getHandlerMapForWorkflow } = require("./handler-registry");

      const handlerMap = getHandlerMapForWorkflow("order-processing");
      expect(handlerMap["order-validate-customer"]).toBe(fakeHandler);
      expect(() => getHandlerMapForWorkflow("nope")).toThrow(
        /No handler map for workflow 'nope'/,
      );
    });
  });

  it("SE-ISO-datasource: DataSource pre-init touches only the served workflow's typeorm package", async () => {
    await jest.isolateModulesAsync(async () => {
      const fakeDataSource = {
        isInitialized: true,
        destroy: jest.fn(async () => undefined),
      };
      jest.doMock(ORDER_TYPEORM, () => ({
        OrderProcessingDataSource: fakeDataSource,
      }));
      jest.doMock(IOT_TYPEORM, throwOnLoad("iot-sensor-pipeline-typeorm"));
      jest.doMock(INFRA_TYPEORM, throwOnLoad("infra-provisioning-typeorm"));
      jest.doMock(ORDER_WORKERS, throwOnLoad("order-processing-workers"));
      jest.doMock(IOT_WORKERS, throwOnLoad("iot-sensor-pipeline-workers"));
      jest.doMock(INFRA_WORKERS, throwOnLoad("infra-provisioning-workers"));

      const { initWorkflowDataSource } = require("./handler-registry");

      const originalDestroy = fakeDataSource.destroy;
      await initWorkflowDataSource("order-processing");

      // destroy() is neutralized for the long-lived host (same contract as
      // the sqs-poller debug-server mode).
      expect(fakeDataSource.destroy).not.toBe(originalDestroy);
      await expect(fakeDataSource.destroy()).resolves.toBeUndefined();
      expect(originalDestroy).not.toHaveBeenCalled();
    });
  });
});
