import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "devices", schema: "dbo" })
export class Device {
  @PrimaryColumn({ name: "device_id", type: "varchar", length: 50 })
  deviceId!: string;

  @Column({ name: "name", type: "varchar", length: 100 })
  name!: string;

  @Column({ name: "type", type: "varchar", length: 50 })
  type!: string;

  @Column({ name: "location", type: "varchar", length: 200 })
  location!: string;

  @Column({ name: "firmware_version", type: "varchar", length: 20 })
  firmwareVersion!: string;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "registered_at", type: "timestamp" })
  registeredAt!: Date;

  @Column({ name: "last_seen_at", type: "timestamp", nullable: true })
  lastSeenAt!: Date | null;
}
