import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "processed_payments" })
export class ProcessedPayment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_payment_id", type: "integer" })
  sourcePaymentId!: number;

  @Column({ name: "external_payment_id", type: "varchar", length: 255, nullable: true })
  externalPaymentId!: string | null;

  @Column({ name: "external_order_id", type: "varchar", length: 255, nullable: true })
  externalOrderId!: string | null;

  @Column({ name: "payment_method", type: "varchar", length: 50, nullable: true })
  paymentMethod!: string | null;

  @Column({ name: "amount", type: "decimal", precision: 10, scale: 2, nullable: true })
  amount!: number | null;

  @Column({ name: "status", type: "varchar", length: 50, nullable: true })
  status!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
