import { Client, Connection } from '@temporalio/client';
import { NativeConnection } from '@temporalio/worker';

export interface ITemporal {
  connection: Connection;
  nativeConnection: NativeConnection;
  client: Client;
}
