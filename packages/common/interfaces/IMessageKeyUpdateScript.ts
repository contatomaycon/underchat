import { IChatMessage } from './IChatMessage';

export interface MessageKeyUpdateScriptParams extends Record<string, unknown> {
  patch: Partial<IChatMessage['message_key']>;
}

export interface MessageKeyBaseline extends Record<string, unknown> {
  message_key: IChatMessage['message_key'];
}
