import "reflect-metadata";
import { DataSource } from "typeorm";
import { ProcessedJob } from "../entities/processed-job.entity";
import { ProcessedCustomer } from "../entities/processed-customer.entity";
import { ProcessedOrder } from "../entities/processed-order.entity";
import { ProcessedLineItem } from "../entities/processed-line-item.entity";
import { ProcessedPayment } from "../entities/processed-payment.entity";
import { ProcessedShipment } from "../entities/processed-shipment.entity";

export const OrderProductDataSource = new DataSource({
  type: "postgres",
  host: process.env.ORDER_PROCESSING_PRODUCT_DB_HOST || "dtm-db",
  port: parseInt(process.env.ORDER_PROCESSING_PRODUCT_DB_PORT || "5432", 10),
  username: process.env.ORDER_PROCESSING_PRODUCT_DB_USER || "order_user",
  password: process.env.ORDER_PROCESSING_PRODUCT_DB_PASSWORD || "order_pass",
  database: process.env.ORDER_PROCESSING_PRODUCT_DB_NAME || "order_processing_product_db",
  entities: [ProcessedJob, ProcessedCustomer, ProcessedOrder, ProcessedLineItem, ProcessedPayment, ProcessedShipment],
  synchronize: false,
  logging: false,
});

export async function createOrderProductDataSource(): Promise<DataSource> {
  if (!OrderProductDataSource.isInitialized) {
    await OrderProductDataSource.initialize();
  }
  return OrderProductDataSource;
}

export async function destroyOrderProductDataSource(): Promise<void> {
  if (OrderProductDataSource.isInitialized) {
    await OrderProductDataSource.destroy();
  }
}
