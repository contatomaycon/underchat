import { IChatMessage } from './IChatMessage';

export type MessageSummaryBaseline = IChatMessage['summary'];

export interface MessageSummaryScriptParams extends Record<string, unknown> {
  baseline: MessageSummaryBaseline;
  patch_is_sent: boolean | null;
  patch_is_delivered: boolean | null;
  patch_is_seen: boolean | null;
  delivery_status: 'sent' | 'delivered' | 'read' | null;
  provider_error_code: number | null;
  provider_status_at: string | null;
}
