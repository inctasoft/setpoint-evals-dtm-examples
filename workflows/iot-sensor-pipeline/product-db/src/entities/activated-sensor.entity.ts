import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "activated_sensors" })
export class ActivatedSensor {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_sensor_id", type: "varchar", length: 255 })
  sourceSensorId!: string;

  @Column({ name: "external_sensor_id", type: "varchar", length: 255, nullable: true })
  externalSensorId!: string | null;

  @Column({ name: "external_device_id", type: "varchar", length: 255, nullable: true })
  externalDeviceId!: string | null;

  @Column({ name: "model", type: "varchar", length: 100, nullable: true })
  model!: string | null;

  @Column({ name: "unit", type: "varchar", length: 50, nullable: true })
  unit!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
