import { injectable } from 'tsyringe';
import {
  MiscMessageGenerationOptions,
  WASendableProduct,
} from '@whiskeysockets/baileys';
import { BaileysHelpersService } from './helpers.service';

@injectable()
export class BaileysMessageProductsBusinessService {
  constructor(private readonly baileysHelpersService: BaileysHelpersService) {}

  /**
   * Envia informações de um produto do catálogo do WhatsApp Business.
   */
  sendProduct(
    jid: string,
    product: WASendableProduct,
    args?: { businessOwnerJid?: string; body?: string; footer?: string },
    options?: MiscMessageGenerationOptions
  ) {
    return this.baileysHelpersService.send(
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
