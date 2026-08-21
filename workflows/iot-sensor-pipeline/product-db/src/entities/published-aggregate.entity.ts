import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "published_aggregates" })
export class PublishedAggregate {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_aggregate_id", type: "varchar", length: 255 })
  sourceAggregateId!: string;

  @Column({ name: "external_aggregate_id", type: "varchar", length: 255, nullable: true })
  externalAggregateId!: string | null;

  @Column({ name: "external_sensor_id", type: "varchar", length: 255, nullable: true })
  externalSensorId!: string | null;

  @Column({ name: "metric", type: "varchar", length: 100, nullable: true })
  metric!: string | null;

  @Column({ name: "value", type: "decimal", precision: 15, scale: 6, nullable: true })
  value!: number | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
