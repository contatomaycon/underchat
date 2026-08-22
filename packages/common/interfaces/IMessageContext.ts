import { TFunction } from 'i18next';
import { ETypeUserChat } from '../enums/ETypeUserChat';
import { IChat } from './IChat';
import { TSecurityKeyScope } from './ISecurityKeyConfig';
import type { OutboundWebhookRequestSource } from '../functions/outboundWebhookRequestSource';

export interface IMessageContext {
  t: TFunction<'translation', undefined>;
  hash: string | null;
  messageId?: string;
  typeUser: ETypeUserChat;
  senderName?: string | null;
  senderUser?: IChat['user'] | null;
  senderUserId?: string | null;
  securityKeyScopes?: TSecurityKeyScope[];
  webhookSource?: OutboundWebhookRequestSource;
}
