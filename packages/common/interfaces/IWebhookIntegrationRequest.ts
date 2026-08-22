import { IMappedWebhookData } from './IMappedWebhookData';

export interface IWebhookIntegrationRequest {
  /** Stable identity of this accepted webhook operation. */
  operation_id?: string;
  integration_entitlement_revision: string;
  account_id: string;
  worker_id: string;
  contact_id: string;
  contact_is_valided: boolean;
  phone_validated?: string;
  phone_ddi_validated?: string | null;
  mapped_data: IMappedWebhookData;
  mapping: Record<string, string | string[]>;
  body: Record<string, unknown>;
  phone: string;
  phone_ddi: string | null;
}
