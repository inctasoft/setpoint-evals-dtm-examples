import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "order_items", schema: "dbo" })
export class OrderItem {
  @PrimaryColumn({ name: "order_item_id", type: "integer" })
  orderItemId!: number;

  @Column({ name: "order_id", type: "integer" })
  orderId!: number;

  @Column({ name: "product_id", type: "integer" })
  productId!: number;

  @Column({ name: "quantity", type: "integer" })
  quantity!: number;

  @Column({ name: "unit_price", type: "decimal", precision: 10, scale: 2 })
  unitPrice!: number;

  @Column({ name: "subtotal", type: "decimal", precision: 10, scale: 2 })
  subtotal!: number;
}
