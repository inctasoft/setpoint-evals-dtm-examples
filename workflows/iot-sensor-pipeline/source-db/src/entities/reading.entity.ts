import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "readings", schema: "dbo" })
export class Reading {
  @PrimaryGeneratedColumn({ name: "reading_id", type: "integer" })
  readingId!: number;

  @Column({ name: "sensor_id", type: "varchar", length: 50 })
  sensorId!: string;

  @Column({ name: "value", type: "decimal", precision: 10, scale: 4 })
  value!: string;

  @Column({ name: "timestamp", type: "timestamp" })
  timestamp!: Date;

  @Column({ name: "quality", type: "varchar", length: 20 })
  quality!: string;

  @Column({ name: "raw_value", type: "decimal", precision: 10, scale: 4, nullable: true })
  rawValue!: string | null;
}
