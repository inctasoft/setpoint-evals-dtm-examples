import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "orders", schema: "dbo" })
export class Order {
  @PrimaryColumn({ name: "order_id", type: "integer" })
  orderId!: number;

  @Column({ name: "customer_id", type: "integer" })
  customerId!: number;

  @Column({ name: "order_date", type: "timestamp" })
  orderDate!: Date;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "total_amount", type: "decimal", precision: 10, scale: 2 })
  totalAmount!: number;

  @Column({ name: "shipping_address", type: "text", nullable: true })
  shippingAddress!: string | null;
}
