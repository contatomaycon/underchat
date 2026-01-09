import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Worker } from '@temporalio/worker';

export interface ITemporal {
  connection: Connection;
  nativeConnection: NativeConnection;
  client: Client;
  registerWorker(worker: Worker): void;
}
