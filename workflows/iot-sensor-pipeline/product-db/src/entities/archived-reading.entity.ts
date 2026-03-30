import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "archived_readings" })
export class ArchivedReading {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_reading_id", type: "varchar", length: 255 })
  sourceReadingId!: string;

  @Column({ name: "external_reading_id", type: "varchar", length: 255, nullable: true })
  externalReadingId!: string | null;

  @Column({ name: "external_sensor_id", type: "varchar", length: 255, nullable: true })
  externalSensorId!: string | null;

  @Column({ name: "value", type: "decimal", precision: 15, scale: 6, nullable: true })
  value!: number | null;

  @Column({ name: "unit", type: "varchar", length: 50, nullable: true })
  unit!: string | null;

  @Column({ name: "reading_timestamp", type: "timestamp", nullable: true })
  readingTimestamp!: Date | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
