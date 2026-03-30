import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "provisioned_compute" })
export class ProvisionedCompute {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_compute_id", type: "varchar", length: 255, nullable: true })
  sourceComputeId!: string | null;

  @Column({ name: "external_compute_id", type: "varchar", length: 255, nullable: true })
  externalComputeId!: string | null;

  @Column({ name: "external_network_id", type: "varchar", length: 255, nullable: true })
  externalNetworkId!: string | null;

  @Column({ name: "instance_type", type: "varchar", length: 100, nullable: true })
  instanceType!: string | null;

  @Column({ name: "instance_count", type: "integer", nullable: true })
  instanceCount!: number | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
