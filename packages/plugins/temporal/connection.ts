import { Connection } from '@temporalio/client';
import { temporalEnvironment } from '@core/config/environments';

export async function connectionTemporal() {
  return Connection.connect({
    address: `${temporalEnvironment.getTemporalHost()}:${temporalEnvironment.getTemporalPort()}`,
    connectTimeout: 10000,
  });
}
