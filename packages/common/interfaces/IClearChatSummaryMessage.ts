export interface IClearChatSummaryMessage {
  chat_id: string;
  account_id: string;
  /** Stable identity of this clear request. */
  operation_id?: string;
  /**
   * Monotonic summary revision observed when this command was created.
   * Legacy documents without a revision are represented by zero.
   */
  expected_summary_revision?: number;
  /** Last message observed when the clear request was created. */
  expected_last_message_id?: string | null;
}
