export const CONTACT_VALIDATION_WEBHOOK_INTEGRATION_SOURCE =
  'webhook_integration' as const;
export const CONTACT_VALIDATION_SCHEDULE_SOURCE = 'schedule' as const;

export interface IContactValidationUpdate {
  contact_id: string;
  phone: string;
  is_validated: boolean;
  account_id?: string;
  worker_id?: string;
  source_provider?: string;
  runtime_generation?: number;
  connection_epoch?: string;
  integration_entitlement_revision?: string;
  operation_id?: string;
  source?: string;
}

export interface IWebhookIntegrationContactValidationUpdate extends IContactValidationUpdate {
  account_id: string;
  integration_entitlement_revision: string;
  source: typeof CONTACT_VALIDATION_WEBHOOK_INTEGRATION_SOURCE;
}
