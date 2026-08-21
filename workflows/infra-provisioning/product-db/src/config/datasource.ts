import "reflect-metadata";
import { DataSource } from "typeorm";
import { ProcessedJob } from "../entities/processed-job.entity";
import { ProvisionedEnvironment } from "../entities/provisioned-environment.entity";
import { ProvisionedNetwork } from "../entities/provisioned-network.entity";
import { ProvisionedCompute } from "../entities/provisioned-compute.entity";
import { ProvisionedStorage } from "../entities/provisioned-storage.entity";
import { ProvisionedDns } from "../entities/provisioned-dns.entity";
import { ProvisionedCertificate } from "../entities/provisioned-certificate.entity";
import { ProvisionedLoadBalancer } from "../entities/provisioned-load-balancer.entity";

export const InfraProductDataSource = new DataSource({
  type: "postgres",
  host: process.env.INFRA_PROVISIONING_PRODUCT_DB_HOST || "dtm-db",
  port: parseInt(process.env.INFRA_PROVISIONING_PRODUCT_DB_PORT || "5432", 10),
  username: process.env.INFRA_PROVISIONING_PRODUCT_DB_USER || "infra_user",
  password: process.env.INFRA_PROVISIONING_PRODUCT_DB_PASSWORD || "infra_pass",
  database: process.env.INFRA_PROVISIONING_PRODUCT_DB_NAME || "infra_provisioning_product_db",
  entities: [
    ProcessedJob,
    ProvisionedEnvironment,
    ProvisionedNetwork,
    ProvisionedCompute,
    ProvisionedStorage,
    ProvisionedDns,
    ProvisionedCertificate,
    ProvisionedLoadBalancer,
  ],
  synchronize: false,
  logging: false,
});

export async function createInfraProductDataSource(): Promise<DataSource> {
  if (!InfraProductDataSource.isInitialized) {
    await InfraProductDataSource.initialize();
  }
  return InfraProductDataSource;
}

export async function destroyInfraProductDataSource(): Promise<void> {
  if (InfraProductDataSource.isInitialized) {
    await InfraProductDataSource.destroy();
  }
}
