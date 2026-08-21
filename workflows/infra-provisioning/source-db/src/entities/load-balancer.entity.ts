import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "load_balancers", schema: "dbo" })
export class LoadBalancer {
  @PrimaryColumn({ name: "lb_id", type: "varchar", length: 50 })
  lbId!: string;

  @Column({ name: "network_id", type: "varchar", length: 50 })
  networkId!: string;

  @Column({ name: "instance_id", type: "varchar", length: 50 })
  instanceId!: string;

  @Column({ name: "name", type: "varchar", length: 100 })
  name!: string;

  @Column({ name: "type", type: "varchar", length: 10 })
  type!: string;

  @Column({ name: "port", type: "integer" })
  port!: number;

  @Column({ name: "protocol", type: "varchar", length: 10 })
  protocol!: string;

  @Column({ name: "health_check_path", type: "varchar", length: 200 })
  healthCheckPath!: string;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
