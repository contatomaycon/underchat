import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageService {
  constructor(private readonly connection: BaileysConnectionService) {}

  async send(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ) {
    const socket = this.connection.getSocket();
    if (!socket) throw new Error('Socket not connected');
    return socket.sendMessage(jid, content, options);
  }
}
