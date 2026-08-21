/**
 * Lambda Workers - Exports
 *
 * This file exports all handler functions for use by the debug-server mode
 * in the SQS poller. Each handler is exported with a unique name that matches
 * the Lambda function name used in LocalStack.
 */

// Customer handlers
export { handler as validateCustomerHandler } from "./handlers/validate-customer";
export { handler as submitCustomerHandler } from "./handlers/submit-customer";

// Product handlers
export { handler as validateProductHandler } from "./handlers/validate-product";

// Order handlers
export { handler as validateOrderHandler } from "./handlers/validate-order";
export { handler as submitOrderHandler } from "./handlers/submit-order";

// Line Items handlers (fan-out pattern)
export { handler as discoverLineItemsHandler } from "./handlers/discover-line-items";
export { handler as validateLineItemHandler } from "./handlers/validate-line-item";
export { handler as submitLineItemHandler } from "./handlers/submit-line-item";

// Payment handlers
export { handler as validatePaymentHandler } from "./handlers/validate-payment";
export { handler as submitPaymentHandler } from "./handlers/submit-payment";

// Shipment handlers
export { handler as validateShipmentHandler } from "./handlers/validate-shipment";
export { handler as submitShipmentHandler } from "./handlers/submit-shipment";

// ─── Handler Map ────────────────────────────────────────────────────────────
// Maps SQS queue names to handler functions for dynamic registration
// Used by the SQS poller's handler registry in debug-server mode

import { handler as validateCustomer } from "./handlers/validate-customer";
import { handler as submitCustomer } from "./handlers/submit-customer";
import { handler as validateProduct } from "./handlers/validate-product";
import { handler as validateOrder } from "./handlers/validate-order";
import { handler as submitOrder } from "./handlers/submit-order";
import { handler as discoverLineItems } from "./handlers/discover-line-items";
import { handler as validateLineItem } from "./handlers/validate-line-item";
import { handler as submitLineItem } from "./handlers/submit-line-item";
import { handler as validatePayment } from "./handlers/validate-payment";
import { handler as submitPayment } from "./handlers/submit-payment";
import { handler as validateShipment } from "./handlers/validate-shipment";
import { handler as submitShipment } from "./handlers/submit-shipment";

/**
 * Queue name -> handler function mapping.
 * Used by the SQS poller handler registry for dynamic multi-workflow support.
 * Queue names must match the queueName fields in workflow.config.ts.
 */
export const handlerMap: Record<string, (event: any, context: any) => Promise<any>> = {
  "order-validate-customer": validateCustomer,
  "order-validate-product": validateProduct,
  "order-submit-customer": submitCustomer,
  "order-validate-order": validateOrder,
  "order-submit-order": submitOrder,
  "order-discover-line-items": discoverLineItems,
  "order-validate-line-item": validateLineItem,
  "order-submit-line-item": submitLineItem,
  "order-validate-payment": validatePayment,
  "order-submit-payment": submitPayment,
  "order-validate-shipment": validateShipment,
  "order-submit-shipment": submitShipment,
};
