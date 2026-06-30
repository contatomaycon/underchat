import type { WhatsappTemplateResponse } from '@core/schema/worker/whatsappOfficialTemplate';

export type ParameterFormat = 'POSITIONAL' | 'NAMED';

export type HeaderFormat =
  'NONE' | 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';

export type ButtonType =
  'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'VOICE_CALL' | 'COPY_CODE';

export interface ButtonDraft {
  type: ButtonType;
  text: string;
  url: string;
  url_type: 'STATIC' | 'DYNAMIC';
  url_example: string;
  phone_country_code: string;
  phone_number: string;
  offer_code: string;
  quick_reply_type: 'CUSTOM' | 'PRESET';
  track_app_conversions: boolean;
  meta_app_id: string;
  android_deep_link: string;
  android_fallback_playstore_url: string;
  voice_call_ttl_minutes: number | null;
}

export interface TemplateDraft {
  name: string;
  language: string;
  category: string;
  sub_category: string | null;
  parameter_format: ParameterFormat;
  header_format: HeaderFormat;
  header_text: string;
  header_handle: string;
  body_text: string;
  footer_text: string;
  custom_ttl_enabled: boolean;
  message_send_ttl_seconds: number | null;
  header_variable_samples: Record<string, string>;
  body_variable_samples: Record<string, string>;
  buttons: ButtonDraft[];
}

export interface SelectOption<T = string> {
  title: string;
  value: T;
  icon?: string;
  description?: string;
}

export interface ButtonEntry {
  button: ButtonDraft;
  index: number;
}

export interface ValidationMessage {
  key: string;
  params?: Record<string, string | number>;
}

export type TranslateFn = (
  key: string,
  params?: Record<string, string | number>
) => string;

export type TemplateEditorModeTemplate = WhatsappTemplateResponse | null;
