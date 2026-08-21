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

  @Column({ name: "device_count", type: "integer", default: 0 })
  deviceCount!: number;

  @Column({ name: "sensor_count", type: "integer", default: 0 })
  sensorCount!: number;

  @Column({ name: "reading_count", type: "integer", default: 0 })
  readingCount!: number;

  @Column({ name: "alert_count", type: "integer", default: 0 })
  alertCount!: number;

  @Column({ name: "aggregate_count", type: "integer", default: 0 })
  aggregateCount!: number;
}
