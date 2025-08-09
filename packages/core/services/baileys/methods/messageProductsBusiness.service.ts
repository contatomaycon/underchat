import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
  WASendableProduct,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageProductsBusinessService {
  constructor(private readonly connection: BaileysConnectionService) {}

  private socket() {
    const s = this.connection.getSocket();
    if (!s) {
      throw new Error('Socket not connected');
    }

    return s;
  }

  send(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ): Promise<proto.WebMessageInfo | undefined> {
    return this.socket().sendMessage(jid, content, options);
  }

  /**
   * Envia informações de um produto do catálogo do WhatsApp Business.
   */
  sendProduct(
    jid: string,
    product: WASendableProduct,
    args?: { businessOwnerJid?: string; body?: string; footer?: string },
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(
      jid,
      {
        product,
        businessOwnerJid: args?.businessOwnerJid,
        body: args?.body,
        footer: args?.footer,
      },
      options
    );
  }
}
