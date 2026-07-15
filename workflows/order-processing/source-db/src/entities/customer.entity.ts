import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "customers", schema: "ecommerce" })
export class Customer {
  @PrimaryColumn({ name: "customer_id", type: "integer" })
  customerId!: number;

  @Column({ name: "first_name", type: "varchar", length: 50 })
  firstName!: string;

  @Column({ name: "last_name", type: "varchar", length: 50 })
  lastName!: string;

  @Column({ name: "email", type: "varchar", length: 100 })
  email!: string;

  @Column({ name: "phone", type: "varchar", length: 20, nullable: true })
  phone!: string | null;

  @Column({ name: "address", type: "text", nullable: true })
  address!: string | null;

  @Column({ name: "created_at", type: "timestamp" })
  createdAt!: Date;
}
