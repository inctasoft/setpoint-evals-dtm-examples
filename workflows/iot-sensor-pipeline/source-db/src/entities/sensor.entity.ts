import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "sensors", schema: "dbo" })
export class Sensor {
  @PrimaryColumn({ name: "sensor_id", type: "varchar", length: 50 })
  sensorId!: string;

  @Column({ name: "device_id", type: "varchar", length: 50 })
  deviceId!: string;

  @Column({ name: "type", type: "varchar", length: 50 })
  type!: string;

  @Column({ name: "unit", type: "varchar", length: 20 })
  unit!: string;

  @Column({ name: "min_threshold", type: "decimal", precision: 10, scale: 2, nullable: true })
  minThreshold!: string | null;

  @Column({ name: "max_threshold", type: "decimal", precision: 10, scale: 2, nullable: true })
  maxThreshold!: string | null;

  @Column({ name: "calibrated_at", type: "timestamp", nullable: true })
  calibratedAt!: Date | null;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;
}
