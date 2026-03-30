import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "shipments", schema: "dbo" })
export class Shipment {
  @PrimaryColumn({ name: "shipment_id", type: "integer" })
  shipmentId!: number;

  @Column({ name: "order_id", type: "integer" })
  orderId!: number;

  @Column({ name: "carrier", type: "varchar", length: 50 })
  carrier!: string;

  @Column({ name: "tracking_number", type: "varchar", length: 100, nullable: true })
  trackingNumber!: string | null;

  @Column({ name: "shipped_date", type: "timestamp", nullable: true })
  shippedDate!: Date | null;

  @Column({ name: "estimated_delivery", type: "timestamp", nullable: true })
  estimatedDelivery!: Date | null;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;
}
