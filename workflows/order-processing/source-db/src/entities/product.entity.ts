import { Entity, PrimaryColumn, Column } from "typeorm";

@Entity({ name: "products", schema: "ecommerce" })
export class Product {
  @PrimaryColumn({ name: "product_id", type: "integer" })
  productId!: number;

  @Column({ name: "name", type: "varchar", length: 100 })
  name!: string;

  @Column({ name: "sku", type: "varchar", length: 50 })
  sku!: string;

  @Column({ name: "price", type: "decimal", precision: 10, scale: 2 })
  price!: number;

  @Column({ name: "category", type: "varchar", length: 50, nullable: true })
  category!: string | null;

  @Column({ name: "description", type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "in_stock", type: "boolean", default: true })
  inStock!: boolean;
}
