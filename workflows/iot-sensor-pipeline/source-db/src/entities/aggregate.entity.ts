import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "aggregates", schema: "dbo" })
export class Aggregate {
  @PrimaryGeneratedColumn({ name: "aggregate_id", type: "integer" })
  aggregateId!: number;

  @Column({ name: "sensor_id", type: "varchar", length: 50 })
  sensorId!: string;

  @Column({ name: "period_start", type: "timestamp" })
  periodStart!: Date;

  @Column({ name: "period_end", type: "timestamp" })
  periodEnd!: Date;

  @Column({ name: "min_value", type: "decimal", precision: 10, scale: 4 })
  minValue!: string;

  @Column({ name: "max_value", type: "decimal", precision: 10, scale: 4 })
  maxValue!: string;

  @Column({ name: "avg_value", type: "decimal", precision: 10, scale: 4 })
  avgValue!: string;

  @Column({ name: "sample_count", type: "integer" })
  sampleCount!: number;

  @Column({ name: "aggregation_type", type: "varchar", length: 20 })
  aggregationType!: string;
}
