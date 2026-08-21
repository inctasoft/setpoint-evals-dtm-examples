import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "processed_shipments" })
export class ProcessedShipment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_shipment_id", type: "integer" })
  sourceShipmentId!: number;

  @Column({ name: "external_shipment_id", type: "varchar", length: 255, nullable: true })
  externalShipmentId!: string | null;

  @Column({ name: "external_order_id", type: "varchar", length: 255, nullable: true })
  externalOrderId!: string | null;

  @Column({ name: "carrier", type: "varchar", length: 50, nullable: true })
  carrier!: string | null;

  @Column({ name: "tracking_number", type: "varchar", length: 200, nullable: true })
  trackingNumber!: string | null;

  @Column({ name: "status", type: "varchar", length: 50, nullable: true })
  status!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
