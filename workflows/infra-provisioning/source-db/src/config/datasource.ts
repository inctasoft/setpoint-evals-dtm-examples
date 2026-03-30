import "reflect-metadata";
import { DataSource } from "typeorm";
import { Environment } from "../entities/environment.entity";
import { Network } from "../entities/network.entity";
import { ComputeInstance } from "../entities/compute-instance.entity";
import { StorageVolume } from "../entities/storage-volume.entity";
import { DnsRecord } from "../entities/dns-record.entity";
import { Certificate } from "../entities/certificate.entity";
import { LoadBalancer } from "../entities/load-balancer.entity";

export const InfraProvisioningDataSource = new DataSource({
  type: "postgres",
  host: process.env.INFRA_PROVISIONING_DB_HOST || "dtm-db",
  port: parseInt(process.env.INFRA_PROVISIONING_DB_PORT || "5432", 10),
  username: process.env.INFRA_PROVISIONING_DB_USER || "infra_user",
  password: process.env.INFRA_PROVISIONING_DB_PASSWORD || "infra_pass",
  database: process.env.INFRA_PROVISIONING_DB_NAME || "infra_provisioning_db",
  entities: [Environment, Network, ComputeInstance, StorageVolume, DnsRecord, Certificate, LoadBalancer],
  synchronize: false,
  logging: false,
});

export async function createInfraProvisioningDataSource(): Promise<DataSource> {
  if (!InfraProvisioningDataSource.isInitialized) {
    await InfraProvisioningDataSource.initialize();
  }
  return InfraProvisioningDataSource;
}

export async function destroyInfraProvisioningDataSource(): Promise<void> {
  if (InfraProvisioningDataSource.isInitialized) {
    await InfraProvisioningDataSource.destroy();
  }
}
