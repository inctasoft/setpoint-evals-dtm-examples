import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "processed_line_items" })
export class ProcessedLineItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_line_item_id", type: "integer" })
  sourceLineItemId!: number;

  @Column({ name: "external_line_item_id", type: "varchar", length: 255, nullable: true })
  externalLineItemId!: string | null;

  @Column({ name: "external_order_id", type: "varchar", length: 255, nullable: true })
  externalOrderId!: string | null;

  @Column({ name: "sku", type: "varchar", length: 100, nullable: true })
  sku!: string | null;

  @Column({ name: "quantity", type: "integer", nullable: true })
  quantity!: number | null;

  @Column({ name: "unit_price", type: "decimal", precision: 10, scale: 2, nullable: true })
  unitPrice!: number | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
