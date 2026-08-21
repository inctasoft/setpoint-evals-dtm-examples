import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "compute_instances", schema: "dbo" })
export class ComputeInstance {
  @PrimaryColumn({ name: "instance_id", type: "varchar", length: 50 })
  instanceId!: string;

  @Column({ name: "network_id", type: "varchar", length: 50 })
  networkId!: string;

  @Column({ name: "name", type: "varchar", length: 100 })
  name!: string;

  @Column({ name: "instance_type", type: "varchar", length: 20 })
  instanceType!: string;

  @Column({ name: "ami_id", type: "varchar", length: 50 })
  amiId!: string;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "public_ip", type: "varchar", length: 20, nullable: true })
  publicIp!: string | null;

  @Column({ name: "private_ip", type: "varchar", length: 20 })
  privateIp!: string;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
