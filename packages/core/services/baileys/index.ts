import { singleton } from 'tsyringe';
import makeWASocket from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './methods/connection.service';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';
import { IBaileysConnection } from '@core/common/interfaces/IBaileysConnection';

@singleton()
export class BaileysService {
  constructor(private readonly connection: BaileysConnectionService) {}

  connect(input: IBaileysConnection): Promise<IBaileysConnectionState> {
    return this.connection.connect(input);
  }

  reconnect(input: IBaileysConnection): void {
    return this.connection.reconnect(input);
  }

  disconnect(input: IBaileysConnection): void {
    this.connection.disconnect(input);
  }

  getStatus(): EBaileysConnectionStatus {
    return this.connection.getStatus();
  }

  get socket(): ReturnType<typeof makeWASocket> | undefined {
    return this.connection.getSocket();
  }
}
