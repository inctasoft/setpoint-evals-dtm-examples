import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "provisioned_storage" })
export class ProvisionedStorage {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_storage_id", type: "varchar", length: 255, nullable: true })
  sourceStorageId!: string | null;

  @Column({ name: "external_storage_id", type: "varchar", length: 255, nullable: true })
  externalStorageId!: string | null;

  @Column({ name: "external_compute_id", type: "varchar", length: 255, nullable: true })
  externalComputeId!: string | null;

  @Column({ name: "storage_type", type: "varchar", length: 50, nullable: true })
  storageType!: string | null;

  @Column({ name: "size_gb", type: "integer", nullable: true })
  sizeGb!: number | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
