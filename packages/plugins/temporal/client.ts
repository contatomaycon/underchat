import { Client } from '@temporalio/client';
import { connectionTemporal } from './connection';

export async function clientTemporal(): Promise<Client> {
  const connection = await connectionTemporal();

  return new Client({
    connection,
  });
}
