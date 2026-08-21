import "reflect-metadata";
import { DataSource } from "typeorm";
import { Device } from "../entities/device.entity";
import { Sensor } from "../entities/sensor.entity";
import { Reading } from "../entities/reading.entity";
import { Alert } from "../entities/alert.entity";
import { Aggregate } from "../entities/aggregate.entity";

export const IotSensorDataSource = new DataSource({
  type: "postgres",
  host: process.env.IOT_SENSOR_DB_HOST || "dtm-db",
  port: parseInt(process.env.IOT_SENSOR_DB_PORT || "5432", 10),
  username: process.env.IOT_SENSOR_DB_USER || "iot_user",
  password: process.env.IOT_SENSOR_DB_PASSWORD || "iot_pass",
  database: process.env.IOT_SENSOR_DB_NAME || "iot_sensor_db",
  entities: [Device, Sensor, Reading, Alert, Aggregate],
  synchronize: false,
  logging: false,
});

export async function createIotSensorDataSource(): Promise<DataSource> {
  if (!IotSensorDataSource.isInitialized) {
    await IotSensorDataSource.initialize();
  }
  return IotSensorDataSource;
}

export async function destroyIotSensorDataSource(): Promise<void> {
  if (IotSensorDataSource.isInitialized) {
    await IotSensorDataSource.destroy();
  }
}
