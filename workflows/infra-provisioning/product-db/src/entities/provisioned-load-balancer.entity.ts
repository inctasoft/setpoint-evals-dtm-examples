import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "provisioned_load_balancers" })
export class ProvisionedLoadBalancer {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_lb_id", type: "varchar", length: 255, nullable: true })
  sourceLbId!: string | null;

  @Column({ name: "external_lb_id", type: "varchar", length: 255, nullable: true })
  externalLbId!: string | null;

  @Column({ name: "external_network_id", type: "varchar", length: 255, nullable: true })
  externalNetworkId!: string | null;

  @Column({ name: "lb_type", type: "varchar", length: 50, nullable: true })
  lbType!: string | null;

  @Column({ name: "endpoint", type: "varchar", length: 255, nullable: true })
  endpoint!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
