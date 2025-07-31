import { injectable } from 'tsyringe';
import makeWASocket, {
  AnyMessageContent,
  MiscMessageGenerationOptions,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './methods/connection.service';
import { BaileysMessageService } from './methods/message.service';
import { EBaileysConnectionStatus } from '@core/common/enums/EBaileysConnectionStatus';
import { IBaileysConnectionState } from '@core/common/interfaces/IBaileysConnectionState';

@injectable()
export class BaileysService {
  constructor(
    private readonly connection: BaileysConnectionService,
    private readonly messages: BaileysMessageService
  ) {}

  connect(
    initialConnection: boolean = false
  ): Promise<IBaileysConnectionState> {
    return this.connection.connect(initialConnection);
  }

  disconnect(
    initialConnection: boolean = false,
    disconnectedUser: boolean = false
  ): void {
    this.connection.disconnect(initialConnection, disconnectedUser);
  }

  getStatus(): EBaileysConnectionStatus {
    return this.connection.getStatus();
  }

  sendMessage(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ) {
    return this.messages.send(jid, content, options);
  }

  get socket(): ReturnType<typeof makeWASocket> | undefined {
    return this.connection.getSocket();
  }
}
