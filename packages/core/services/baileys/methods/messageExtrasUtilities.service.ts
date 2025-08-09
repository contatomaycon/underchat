import { injectable } from 'tsyringe';
import {
  AnyMessageContent,
  MiscMessageGenerationOptions,
  proto,
  WAMessage,
} from '@whiskeysockets/baileys';
import { BaileysConnectionService } from './connection.service';

@injectable()
export class BaileysMessageExtrasUtilitiesService {
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
   * Envia mensagem com contextInfo (ex.: metadados, citações avançadas, menções).
   */
  sendWithContext(
    jid: string,
    content: AnyMessageContent,
    contextInfo: proto.IContextInfo,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { ...(content as any), contextInfo }, options);
  }

  /**
   * Envia mensagem com ID customizado (messageId).
   */
  sendWithMessageId(
    jid: string,
    content: AnyMessageContent,
    messageId: string,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, content, { ...options, messageId });
  }

  /**
   * Envia mensagem como broadcast para vários JIDs.
   */
  sendAsBroadcast(
    jid: string,
    content: AnyMessageContent,
    statusJidList: string[],
    args?: { backgroundColor?: string; font?: number },
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, content, {
      ...(options || {}),
      statusJidList,
      backgroundColor: args?.backgroundColor,
      font: args?.font,
      broadcast: true,
    });
  }

  /**
   * Força qualquer mensagem a ser enviada como viewOnce.
   */
  sendWithViewOnce(
    jid: string,
    inner: AnyMessageContent,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, { ...(inner as any), viewOnce: true }, options);
  }

  /**
   * Envia mensagem com duração efêmera (apaga após X segundos).
   */
  sendEphemeral(
    jid: string,
    inner: AnyMessageContent,
    seconds: number,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, inner, {
      ...(options || {}),
      ephemeralExpiration: seconds,
    });
  }

  /**
   * Envia qualquer tipo de mensagem citando outra.
   */
  sendWithQuoted(
    jid: string,
    inner: AnyMessageContent,
    quoted: WAMessage,
    options?: MiscMessageGenerationOptions
  ) {
    return this.send(jid, inner, { ...(options || {}), quoted });
  }

  /**
   * Envia para status@broadcast diretamente, definindo a lista de destinatários.
   */
  sendToStatusRecipients(
    content: AnyMessageContent,
    recipients: string[],
    options?: MiscMessageGenerationOptions
  ) {
    return this.send('status@broadcast', content, {
      ...(options || {}),
      statusJidList: recipients,
      broadcast: true,
    });
  }
}
