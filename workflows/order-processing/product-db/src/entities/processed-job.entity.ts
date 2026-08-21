import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "processed_jobs" })
export class ProcessedJob {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255, unique: true })
  jobId!: string;

  @Column({ name: "workflow_name", type: "varchar", length: 100 })
  workflowName!: string;

  @Column({ name: "started_at", type: "timestamp", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "completed_at", type: "timestamp", default: () => "NOW()" })
  completedAt!: Date;

  @Column({ name: "customer_count", type: "integer", default: 0 })
  customerCount!: number;

  @Column({ name: "order_count", type: "integer", default: 0 })
  orderCount!: number;

  @Column({ name: "line_item_count", type: "integer", default: 0 })
  lineItemCount!: number;

  @Column({ name: "payment_count", type: "integer", default: 0 })
  paymentCount!: number;

  @Column({ name: "shipment_count", type: "integer", default: 0 })
  shipmentCount!: number;
}
