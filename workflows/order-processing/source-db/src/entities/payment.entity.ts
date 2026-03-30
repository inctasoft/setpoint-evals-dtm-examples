import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "payments", schema: "dbo" })
export class Payment {
  @PrimaryColumn({ name: "payment_id", type: "integer" })
  paymentId!: number;

  @Column({ name: "order_id", type: "integer" })
  orderId!: number;

  @Column({ name: "payment_method", type: "varchar", length: 50 })
  paymentMethod!: string;

  @Column({ name: "amount", type: "decimal", precision: 10, scale: 2 })
  amount!: number;

  @Column({ name: "payment_date", type: "timestamp" })
  paymentDate!: Date;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "transaction_ref", type: "varchar", length: 100, nullable: true })
  transactionRef!: string | null;
}
