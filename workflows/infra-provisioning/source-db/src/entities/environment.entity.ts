import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "environments", schema: "dbo" })
export class Environment {
  @PrimaryColumn({ name: "environment_id", type: "varchar", length: 50 })
  environmentId!: string;

  @Column({ name: "name", type: "varchar", length: 100 })
  name!: string;

  @Column({ name: "type", type: "varchar", length: 20 })
  type!: string;

  @Column({ name: "region", type: "varchar", length: 50 })
  region!: string;

  @Column({ name: "account_id", type: "varchar", length: 50 })
  accountId!: string;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
