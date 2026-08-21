import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "processed_jobs" })
export class ProcessedJob {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255, unique: true })
  jobId!: string;

  @Column({ name: "workflow_name", type: "varchar", length: 100 })
  workflowName!: string;

  @Column({ name: "completed_at", type: "timestamp", default: () => "NOW()" })
  completedAt!: Date;

  @Column({ name: "environment_count", type: "integer", default: 0 })
  environmentCount!: number;

  @Column({ name: "network_count", type: "integer", default: 0 })
  networkCount!: number;

  @Column({ name: "compute_count", type: "integer", default: 0 })
  computeCount!: number;

  @Column({ name: "storage_count", type: "integer", default: 0 })
  storageCount!: number;

  @Column({ name: "dns_count", type: "integer", default: 0 })
  dnsCount!: number;

  @Column({ name: "certificate_count", type: "integer", default: 0 })
  certificateCount!: number;

  @Column({ name: "load_balancer_count", type: "integer", default: 0 })
  loadBalancerCount!: number;
}
