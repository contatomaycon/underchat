export interface IChatSummary {
  last_message: string | null;
  last_date: string | null;
  unread_count: number;
}

export interface IChatSummaryUpdateParams {
  last_message?: string | null;
  last_date?: string | null;
  unread_count_delta?: number;
  unread_count_absolute?: number;
}

export interface IChatSummaryScriptParams {
  last_message: string | null;
  last_date: string;
  increment_unread_count: boolean;
  baseline: IChatSummary;
}
