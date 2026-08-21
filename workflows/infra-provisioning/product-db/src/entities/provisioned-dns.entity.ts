import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "provisioned_dns" })
export class ProvisionedDns {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_dns_id", type: "varchar", length: 255, nullable: true })
  sourceDnsId!: string | null;

  @Column({ name: "external_dns_id", type: "varchar", length: 255, nullable: true })
  externalDnsId!: string | null;

  @Column({ name: "external_network_id", type: "varchar", length: 255, nullable: true })
  externalNetworkId!: string | null;

  @Column({ name: "zone", type: "varchar", length: 200, nullable: true })
  zone!: string | null;

  @Column({ name: "record_count", type: "integer", nullable: true })
  recordCount!: number | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
