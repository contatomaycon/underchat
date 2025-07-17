import { injectable } from 'tsyringe';
import { Client, ConnectConfig } from 'ssh2';

@injectable()
export class SshService {
  constructor() {}

  testSSHConnection = async (config: ConnectConfig): Promise<boolean> => {
    return new Promise((resolve) => {
      const conn = new Client();

      conn
        .on('ready', () => {
          conn.end();

          resolve(true);
        })
        .on('error', () => {
          resolve(false);
        })
        .connect(config);
    });
  };
}
