/**
 * E2E Test: Order Processing Happy Path (Line Item Fan-Out)
 *
 * Tests the order processing pipeline WITHOUT simulated delays:
 * 1. Trigger job
 * 2. Customer validated and submitted
 * 3. Order validated and submitted
 * 4. Line Items discovered, validated, and submitted (fan-out)
 *
 * This test directly queries the database to verify:
 * - Job status progression
 * - Step completion with output data
 * - Submitted line item structure
 *
 * Prerequisites:
 * - Docker services running (orchestrator, postgres, workflow source DBs, kafka, localstack)
 * - workflow source database with test data (customer with orders and line items)
 * - NO simulated delays - fast execution
 *
 * Usage:
 *   cd services/orchestrator
 *   npm run test:e2e -- --testPathPattern=order-processing-happy-path
 */

import { DatabaseHelper, ServiceHelper, AssertionHelper } from './test-helpers';

describe('Order Processing Happy Path E2E', () => {
  let db: DatabaseHelper;
  let service: ServiceHelper;
  let _assertion: AssertionHelper;

  // Test data - Customer CUST-1027 has order with line items
  const TEST_CUSTOMER_ID = 'CUST-1027';
  const TEST_ORDER_ID = 'ORD-1027';
  const EXPECTED_LINE_ITEM_COUNT = 3; // From seed data

  beforeAll(async () => {
    db = new DatabaseHelper();
    service = new ServiceHelper();
    _assertion = new AssertionHelper();

    // Wait for orchestrator to be ready
    console.log('Waiting for orchestrator to be ready...');
    await service.waitForServiceHealth();
    console.log('Orchestrator is ready');
  }, 60000);

  afterAll(async () => {
    await db.close();
  });

  describe('Complete Order Processing Flow', () => {
    let jobId: string;

    afterEach(async () => {
      if (jobId) {
        // Optional: Clean up test data
        // await db.cleanTestData(jobId);
      }
    });

    it('should verify test data exists in workflow source DB', async () => {
      // Verify customer exists
      const customer = await db.getWorkflowCustomer(
        parseInt(TEST_CUSTOMER_ID.replace('CUST-', ''), 10),
      );
      expect(customer).toBeDefined();
      console.log(`Found customer ${TEST_CUSTOMER_ID} in workflow source DB`);

      // Verify order exists
      const order = await db.getWorkflowOrder(TEST_ORDER_ID);
      expect(order).toBeDefined();
      console.log(`Found order ${TEST_ORDER_ID} in workflow source DB`);

      // Verify line items exist
      const lineItemCount = await db.getWorkflowLineItemsCount(TEST_ORDER_ID);
      expect(lineItemCount).toBe(EXPECTED_LINE_ITEM_COUNT);
      console.log(`Found ${lineItemCount} line item records for order ${TEST_ORDER_ID}`);
    });

    it('should complete full order processing flow', async () => {
      // Phase 1: Trigger job
      console.log('\nPhase 1: Triggering job...');
      const result = await service.triggerJob(TEST_CUSTOMER_ID, {
        orderId: TEST_ORDER_ID,
      });
      jobId = result.jobId;
      expect(jobId).toBeDefined();
      console.log(`Job triggered with jobId: ${jobId}`);

      // Phase 2: Wait for job to complete
      console.log('\nPhase 2: Waiting for job completion...');
      const completedJob = await db.waitForJobStatus(jobId, 'completed', 180000, 1000);
      expect(completedJob.status).toBe('completed');
      console.log(`Job completed`);

      // Phase 3: Verify all steps completed
      console.log('\nPhase 3: Verifying steps...');
      const steps = await db.getJobSteps(jobId);

      console.log('Steps found:');
      steps.forEach((step) => {
        console.log(`  - ${step.stepValue}: ${step.status}`);
      });

      // Check customer steps
      const validateCustomer = steps.find((s) => s.stepValue === 'ValidateCustomer');
      expect(validateCustomer?.status).toBe('completed');
      console.log('ValidateCustomer completed');

      const submitCustomer = steps.find((s) => s.stepValue === 'SubmitCustomer');
      expect(submitCustomer?.status).toBe('completed');
      console.log('SubmitCustomer completed');

      // Check order steps
      const validateOrder = steps.find((s) => s.stepValue === 'ValidateOrder');
      expect(validateOrder?.status).toBe('completed');
      console.log('ValidateOrder completed');

      const submitOrder = steps.find((s) => s.stepValue === 'SubmitOrder');
      expect(submitOrder?.status).toBe('completed');
      console.log('SubmitOrder completed');

      // Check line item steps (fan-out mode)
      const discoverLineItems = steps.find((s) => s.stepValue === 'DiscoverLineItems');
      expect(discoverLineItems).toBeDefined();
      expect(discoverLineItems?.status).toBe('completed');
      console.log('DiscoverLineItems completed');

      // In fan-out mode, we should have ValidateLineItem and SubmitLineItem child steps
      const validateLISteps = steps.filter((s) => s.stepValue.startsWith('ValidateLineItem'));
      const submitLISteps = steps.filter((s) => s.stepValue.startsWith('SubmitLineItem'));

      console.log(`Found ${validateLISteps.length} ValidateLineItem steps`);
      console.log(`Found ${submitLISteps.length} SubmitLineItem steps`);

      // Verify expected count matches discovered records
      expect(validateLISteps.length).toBe(EXPECTED_LINE_ITEM_COUNT);
      expect(submitLISteps.length).toBe(EXPECTED_LINE_ITEM_COUNT);

      // All should be completed
      validateLISteps.forEach((s) => {
        expect(s.status).toBe('completed');
      });
      submitLISteps.forEach((s) => {
        expect(s.status).toBe('completed');
      });

      console.log('\nALL LINE ITEM STEPS COMPLETED SUCCESSFULLY');
    }, 180000); // 3 minute timeout

    it('should have correct submitted line item structure', async () => {
      // Skip if no jobId from previous test
      if (!jobId) {
        console.log('Skipping - no jobId from previous test');
        return;
      }

      const steps = await db.getJobSteps(jobId);

      // Verify SubmitLineItem output structure
      const submitLISteps = steps.filter((s) => s.stepValue.startsWith('SubmitLineItem'));

      submitLISteps.forEach((step, index) => {
        if (step.output) {
          const output = step.output as Record<string, unknown>;
          expect(output).toHaveProperty('submittedLineItem');

          // submittedLineItem can be an array (batch) or object (single)
          const submittedData = output.submittedLineItem;
          const submitted = Array.isArray(submittedData)
            ? (submittedData[0] as Record<string, unknown>)
            : (submittedData as Record<string, unknown>);

          // Verify key fields exist in submitted data
          expect(submitted).toHaveProperty('line_item_id');
          expect(submitted).toHaveProperty('item_status');
          expect(submitted).toHaveProperty('currency_code');
          expect(submitted).toHaveProperty('total_amount');

          console.log(`SubmitLineItem[${index}] has correct structure`);
        }
      });
    });
  });

  describe('Order with Empty Line Items', () => {
    it('should handle order with no line items gracefully', async () => {
      // Use a customer without line items
      const CUSTOMER_ID = 'CUST-1014';
      const ORDER_ID = 'ORD-1014';

      // Verify test data exists but has no line items
      const customer = await db.getWorkflowCustomer(1014);
      if (!customer) {
        console.log('Skipping - customer 1014 not found');
        return;
      }

      const lineItemCount = await db.getWorkflowLineItemsCount(ORDER_ID);
      if (lineItemCount > 0) {
        console.log('Skipping - order ORD-1014 has line items');
        return;
      }

      console.log(`Customer ${CUSTOMER_ID} has ${lineItemCount} line item records`);

      // Trigger job
      console.log('\nTriggering job...');
      const result = await service.triggerJob(CUSTOMER_ID, {
        orderId: ORDER_ID,
      });
      const jobId = result.jobId;
      console.log(`Job triggered with jobId: ${jobId}`);

      // Wait for completion
      await db.waitForJobStatus(jobId, 'completed', 120000);
      console.log('Job completed');

      // Verify DiscoverLineItems completed (with 0 records discovered)
      const steps = await db.getJobSteps(jobId);
      const discoverLI = steps.find((s) => s.stepValue === 'DiscoverLineItems');

      if (discoverLI) {
        expect(discoverLI.status).toBe('completed');
        console.log('DiscoverLineItems completed (with 0 records)');

        // No child steps should exist
        const validateLISteps = steps.filter((s) => s.stepValue.startsWith('ValidateLineItem'));
        expect(validateLISteps.length).toBe(0);
        console.log('No child ValidateLineItem steps created');
      }
    }, 120000);
  });
});
