import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "processed_customers" })
export class ProcessedCustomer {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_customer_id", type: "integer" })
  sourceCustomerId!: number;

  @Column({ name: "external_customer_id", type: "varchar", length: 255, nullable: true })
  externalCustomerId!: string | null;

  @Column({ name: "full_name", type: "varchar", length: 200, nullable: true })
  fullName!: string | null;

  @Column({ name: "email_address", type: "varchar", length: 200, nullable: true })
  emailAddress!: string | null;

  @Column({ name: "phone_number", type: "varchar", length: 50, nullable: true })
  phoneNumber!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
