import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "certificates", schema: "dbo" })
export class Certificate {
  @PrimaryColumn({ name: "certificate_id", type: "varchar", length: 50 })
  certificateId!: string;

  @Column({ name: "dns_record_id", type: "varchar", length: 50 })
  dnsRecordId!: string;

  @Column({ name: "domain", type: "varchar", length: 200 })
  domain!: string;

  @Column({ name: "issuer", type: "varchar", length: 100 })
  issuer!: string;

  @Column({ name: "status", type: "varchar", length: 20 })
  status!: string;

  @Column({ name: "issued_at", type: "timestamp", nullable: true })
  issuedAt!: Date | null;

  @Column({ name: "expires_at", type: "timestamp", nullable: true })
  expiresAt!: Date | null;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
