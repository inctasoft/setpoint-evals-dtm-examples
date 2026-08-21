import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "provisioned_environments" })
export class ProvisionedEnvironment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_env_id", type: "varchar", length: 255, nullable: true })
  sourceEnvId!: string | null;

  @Column({ name: "external_env_id", type: "varchar", length: 255, nullable: true })
  externalEnvId!: string | null;

  @Column({ name: "name", type: "varchar", length: 200, nullable: true })
  name!: string | null;

  @Column({ name: "cloud_provider", type: "varchar", length: 50, nullable: true })
  cloudProvider!: string | null;

  @Column({ name: "region", type: "varchar", length: 100, nullable: true })
  region!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
