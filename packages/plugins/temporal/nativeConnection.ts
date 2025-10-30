import { NativeConnection } from '@temporalio/worker';
import { temporalEnvironment } from '@core/config/environments';

export async function nativeConnectionTemporal() {
  return NativeConnection.connect({
    address: `${temporalEnvironment.getTemporalHost()}:${temporalEnvironment.getTemporalPort()}`,
  });
}
