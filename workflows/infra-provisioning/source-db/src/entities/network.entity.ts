import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "networks", schema: "dbo" })
export class Network {
  @PrimaryColumn({ name: "network_id", type: "varchar", length: 50 })
  networkId!: string;

  @Column({ name: "environment_id", type: "varchar", length: 50 })
  environmentId!: string;

  @Column({ name: "name", type: "varchar", length: 100 })
  name!: string;

  @Column({ name: "vpc_cidr", type: "varchar", length: 20 })
  vpcCidr!: string;

  @Column({ name: "subnet_cidr", type: "varchar", length: 20 })
  subnetCidr!: string;

  @Column({ name: "availability_zone", type: "varchar", length: 20 })
  availabilityZone!: string;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
