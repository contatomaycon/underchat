export type ChatbotUnderchatLookupType = 'email' | 'document';

export interface ChatbotUnderchatUserOutput {
  readonly email: string | null;
  readonly name: string | null;
  readonly status: string | null;
  readonly document: string | null;
  readonly phone: string | null;
  readonly access_group: string | null;
  readonly sectors: readonly string[];
  readonly channels: readonly string[];
}

export interface ChatbotUnderchatAccountOutput {
  readonly id: string | null;
  readonly name: string | null;
  readonly status: string | null;
  readonly plan: string | null;
  readonly billing_period: string | null;
  readonly last_payment_at: string | null;
  readonly next_renewal_at: string | null;
  readonly last_paid_amount: number | null;
}

export interface ChatbotUnderchatLookupOutput {
  readonly found: boolean;
  readonly user: ChatbotUnderchatUserOutput;
  readonly account: ChatbotUnderchatAccountOutput;
}

export interface ChatbotUnderchatLookupInput {
  readonly lookupType: ChatbotUnderchatLookupType;
  readonly value: string;
}

export const createEmptyChatbotUnderchatLookupOutput =
  (): ChatbotUnderchatLookupOutput => ({
    found: false,
    user: {
      email: null,
      name: null,
      status: null,
      document: null,
      phone: null,
      access_group: null,
      sectors: [],
      channels: [],
    },
    account: {
      id: null,
      name: null,
      status: null,
      plan: null,
      billing_period: null,
      last_payment_at: null,
      next_renewal_at: null,
      last_paid_amount: null,
    },
  });
