import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity({ name: "provisioned_certificates" })
export class ProvisionedCertificate {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "job_id", type: "varchar", length: 255 })
  jobId!: string;

  @Column({ name: "source_cert_id", type: "varchar", length: 255, nullable: true })
  sourceCertId!: string | null;

  @Column({ name: "external_cert_id", type: "varchar", length: 255, nullable: true })
  externalCertId!: string | null;

  @Column({ name: "external_dns_id", type: "varchar", length: 255, nullable: true })
  externalDnsId!: string | null;

  @Column({ name: "domain", type: "varchar", length: 255, nullable: true })
  domain!: string | null;

  @Column({ name: "issuer", type: "varchar", length: 100, nullable: true })
  issuer!: string | null;

  @Column({ name: "processed_at", type: "timestamp", default: () => "NOW()" })
  processedAt!: Date;
}
