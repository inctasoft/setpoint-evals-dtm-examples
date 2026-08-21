import "reflect-metadata";
import { DataSource } from "typeorm";
import { ProcessedJob } from "../entities/processed-job.entity";
import { RegisteredDevice } from "../entities/registered-device.entity";
import { ActivatedSensor } from "../entities/activated-sensor.entity";
import { ArchivedReading } from "../entities/archived-reading.entity";
import { DispatchedAlert } from "../entities/dispatched-alert.entity";
import { PublishedAggregate } from "../entities/published-aggregate.entity";

export const IotProductDataSource = new DataSource({
  type: "postgres",
  host: process.env.IOT_SENSOR_PIPELINE_PRODUCT_DB_HOST || "dtm-db",
  port: parseInt(process.env.IOT_SENSOR_PIPELINE_PRODUCT_DB_PORT || "5432", 10),
  username: process.env.IOT_SENSOR_PIPELINE_PRODUCT_DB_USER || "iot_user",
  password: process.env.IOT_SENSOR_PIPELINE_PRODUCT_DB_PASSWORD || "iot_pass",
  database: process.env.IOT_SENSOR_PIPELINE_PRODUCT_DB_NAME || "iot_sensor_pipeline_product_db",
  entities: [ProcessedJob, RegisteredDevice, ActivatedSensor, ArchivedReading, DispatchedAlert, PublishedAggregate],
  synchronize: false,
  logging: false,
});

export async function createIotProductDataSource(): Promise<DataSource> {
  if (!IotProductDataSource.isInitialized) {
    await IotProductDataSource.initialize();
  }
  return IotProductDataSource;
}

export async function destroyIotProductDataSource(): Promise<void> {
  if (IotProductDataSource.isInitialized) {
    await IotProductDataSource.destroy();
  }
}
