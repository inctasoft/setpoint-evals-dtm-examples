import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "alerts", schema: "dbo" })
export class Alert {
  @PrimaryGeneratedColumn({ name: "alert_id", type: "integer" })
  alertId!: number;

  @Column({ name: "device_id", type: "varchar", length: 50 })
  deviceId!: string;

  @Column({ name: "sensor_id", type: "varchar", length: 50, nullable: true })
  sensorId!: string | null;

  @Column({ name: "severity", type: "varchar", length: 20 })
  severity!: string;

  @Column({ name: "message", type: "text" })
  message!: string;

  @Column({ name: "triggered_at", type: "timestamp" })
  triggeredAt!: Date;

  @Column({ name: "acknowledged_at", type: "timestamp", nullable: true })
  acknowledgedAt!: Date | null;

  @Column({ name: "resolved_at", type: "timestamp", nullable: true })
  resolvedAt!: Date | null;
}
