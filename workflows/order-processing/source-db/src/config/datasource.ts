import "reflect-metadata";
import { DataSource } from "typeorm";
import { Customer } from "../entities/customer.entity";
import { Product } from "../entities/product.entity";
import { Order } from "../entities/order.entity";
import { OrderItem } from "../entities/order-item.entity";
import { Payment } from "../entities/payment.entity";
import { Shipment } from "../entities/shipment.entity";

export const OrderProcessingDataSource = new DataSource({
  type: "postgres",
  host: process.env.ORDER_PROCESSING_DB_HOST || "dtm-db",
  port: parseInt(process.env.ORDER_PROCESSING_DB_PORT || "5432", 10),
  username: process.env.ORDER_PROCESSING_DB_USER || "order_user",
  password: process.env.ORDER_PROCESSING_DB_PASSWORD || "order_pass",
  database: process.env.ORDER_PROCESSING_DB_NAME || "order_processing_db",
  entities: [Customer, Product, Order, OrderItem, Payment, Shipment],
  synchronize: false,
  logging: false,
});

export async function createOrderProcessingDataSource(): Promise<DataSource> {
  if (!OrderProcessingDataSource.isInitialized) {
    await OrderProcessingDataSource.initialize();
  }
  return OrderProcessingDataSource;
}

export async function destroyOrderProcessingDataSource(): Promise<void> {
  if (OrderProcessingDataSource.isInitialized) {
    await OrderProcessingDataSource.destroy();
  }
}
