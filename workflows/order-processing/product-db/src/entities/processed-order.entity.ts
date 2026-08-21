import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "processed_orders" })
export class ProcessedOrder {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_order_id", type: "integer" })
  sourceOrderId!: number;

  @Column({ name: "external_order_id", type: "varchar", length: 255, nullable: true })
  externalOrderId!: string | null;

  @Column({ name: "external_customer_id", type: "varchar", length: 255, nullable: true })
  externalCustomerId!: string | null;

  @Column({ name: "total_amount", type: "decimal", precision: 10, scale: 2, nullable: true })
  totalAmount!: number | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
