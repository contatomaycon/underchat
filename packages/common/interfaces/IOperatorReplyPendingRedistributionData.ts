export type TOperatorReplyPendingRedistributionStage =
  'waiting' | 'transferring' | 'effects_pending';

export interface IOperatorReplyPendingRedistributionData {
  account_id: string;
  worker_id: string;
  chat_id: string;
  tracking_id: string;
  pending_since: string;
  redistribution_count: number;
  retry_count: number;
  stage: TOperatorReplyPendingRedistributionStage;
  expected_primary_user_id: string;
  expected_assignment_event_id: string | null;
  expected_assignment_epoch: number | null;
  expected_status_event_id: string | null;
  expected_status_epoch: number | null;
  expected_last_message_id: string | null;
  expected_summary_revision: number;
  transfer_event_id?: string | null;
  previous_user?: {
    id: string;
    name: string;
    photo?: string | null;
    entered_at?: string | null;
  } | null;
  target_user?: {
    id: string;
    name: string;
    photo?: string | null;
    entered_at?: string | null;
  } | null;
  effects_completed?: {
    realtime?: boolean;
    notification?: boolean;
    annotation?: boolean;
  };
}
