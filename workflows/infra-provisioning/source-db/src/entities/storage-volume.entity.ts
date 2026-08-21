import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "storage_volumes", schema: "dbo" })
export class StorageVolume {
  @PrimaryColumn({ name: "volume_id", type: "varchar", length: 50 })
  volumeId!: string;

  @Column({ name: "instance_id", type: "varchar", length: 50 })
  instanceId!: string;

  @Column({ name: "name", type: "varchar", length: 100 })
  name!: string;

  @Column({ name: "size_gb", type: "integer" })
  sizeGb!: number;

  @Column({ name: "volume_type", type: "varchar", length: 10 })
  volumeType!: string;

  @Column({ name: "iops", type: "integer", nullable: true })
  iops!: number | null;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "attached_at", type: "timestamp", nullable: true })
  attachedAt!: Date | null;
}
