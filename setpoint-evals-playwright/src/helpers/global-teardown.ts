import { closeDbPool } from '../fixtures/db-client.fixture';

export default async function globalTeardown(): Promise<void> {
  await closeDbPool();
}
