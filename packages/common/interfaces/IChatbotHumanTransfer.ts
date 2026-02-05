export type HumanTransferMode = 'disabled' | 'standard' | 'prompt';

export interface IPromptTransferDecision {
  intent: 'human_support' | 'no_transfer';
  sector_id: string | null;
  user_id: string | null;
  message: string;
}

export interface ITransferSectorOption {
  id: string;
  name: string;
  color?: string | null;
}

export interface ITransferUserOption {
  id: string;
  name: string;
  last_name?: string | null;
  nickname?: string | null;
  photo?: string | null;
  status?: string | null;
}
