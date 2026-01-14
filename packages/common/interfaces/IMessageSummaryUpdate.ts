import { IChatMessage } from './IChatMessage';

export type MessageSummaryBaseline = IChatMessage['summary'];

export interface MessageSummaryScriptParams extends Record<string, unknown> {
  baseline: MessageSummaryBaseline;
  patch_is_sent: boolean | null;
  patch_is_delivered: boolean | null;
  patch_is_seen: boolean | null;
}
