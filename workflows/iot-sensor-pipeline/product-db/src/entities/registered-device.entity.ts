import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "registered_devices" })
export class RegisteredDevice {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_device_id", type: "varchar", length: 255 })
  sourceDeviceId!: string;

  @Column({ name: "external_device_id", type: "varchar", length: 255, nullable: true })
  externalDeviceId!: string | null;

  @Column({ name: "device_type", type: "varchar", length: 100, nullable: true })
  deviceType!: string | null;

  @Column({ name: "location", type: "varchar", length: 255, nullable: true })
  location!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
