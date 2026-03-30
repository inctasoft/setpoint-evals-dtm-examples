import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "dispatched_alerts" })
export class DispatchedAlert {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_alert_id", type: "varchar", length: 255 })
  sourceAlertId!: string;

  @Column({ name: "external_alert_id", type: "varchar", length: 255, nullable: true })
  externalAlertId!: string | null;

  @Column({ name: "external_device_id", type: "varchar", length: 255, nullable: true })
  externalDeviceId!: string | null;

  @Column({ name: "severity", type: "varchar", length: 50, nullable: true })
  severity!: string | null;

  @Column({ name: "message", type: "text", nullable: true })
  message!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
