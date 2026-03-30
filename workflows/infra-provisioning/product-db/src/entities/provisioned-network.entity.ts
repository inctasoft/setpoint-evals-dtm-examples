import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "provisioned_networks" })
export class ProvisionedNetwork {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_network_id", type: "varchar", length: 255, nullable: true })
  sourceNetworkId!: string | null;

  @Column({ name: "external_network_id", type: "varchar", length: 255, nullable: true })
  externalNetworkId!: string | null;

  @Column({ name: "external_env_id", type: "varchar", length: 255, nullable: true })
  externalEnvId!: string | null;

  @Column({ name: "cidr", type: "varchar", length: 50, nullable: true })
  cidr!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
