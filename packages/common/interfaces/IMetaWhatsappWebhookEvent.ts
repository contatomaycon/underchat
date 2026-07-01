export interface IMetaWhatsappWebhookMetadata {
  display_phone_number?: string;
  phone_number_id?: string;
}

export interface IMetaWhatsappWebhookChangeValue {
  messaging_product?: string;
  metadata?: IMetaWhatsappWebhookMetadata;
  contacts?: Array<Record<string, unknown>>;
  messages?: Array<Record<string, unknown>>;
  statuses?: Array<Record<string, unknown>>;
  errors?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface IMetaWhatsappWebhookChange {
  field?: string;
  value?: IMetaWhatsappWebhookChangeValue;
}

export interface IMetaWhatsappWebhookEntry {
  id?: string;
  changes?: IMetaWhatsappWebhookChange[];
  [key: string]: unknown;
}

export interface IMetaWhatsappWebhookPayload {
  object?: string;
  entry?: IMetaWhatsappWebhookEntry[];
  [key: string]: unknown;
}

export interface IMetaWhatsappWebhookEvent {
  received_at: string;
  payload: IMetaWhatsappWebhookPayload;
  raw_body_sha256: string;
  signature_header: string | null;
}
