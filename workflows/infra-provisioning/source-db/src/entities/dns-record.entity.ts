import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "dns_records", schema: "dbo" })
export class DnsRecord {
  @PrimaryColumn({ name: "record_id", type: "varchar", length: 50 })
  recordId!: string;

  @Column({ name: "network_id", type: "varchar", length: 50 })
  networkId!: string;

  @Column({ name: "instance_id", type: "varchar", length: 50 })
  instanceId!: string;

  @Column({ name: "hostname", type: "varchar", length: 200 })
  hostname!: string;

  @Column({ name: "record_type", type: "varchar", length: 10 })
  recordType!: string;

  @Column({ name: "value", type: "varchar", length: 200 })
  value!: string;

  @Column({ name: "ttl", type: "integer" })
  ttl!: number;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
