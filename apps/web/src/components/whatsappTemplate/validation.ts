import { toE164Digits } from './payload';
import type { ButtonDraft, TemplateDraft, ValidationMessage } from './types';

export type ButtonField =
  | 'text'
  | 'url'
  | 'url_example'
  | 'phone_number'
  | 'offer_code'
  | 'meta_app_id'
  | 'android_deep_link'
  | 'android_fallback_playstore_url';

export const textStartsOrEndsWithVariable = (text: string) => {
  const trimmed = text.trim();

  return /^\{\{[^}]+\}\}/u.test(trimmed) || /\{\{[^}]+\}\}$/u.test(trimmed);
};

export const hasHighVariableDensity = (text: string, variableCount: number) => {
  if (variableCount <= 1) return false;
  const words = text
    .replace(/\{\{[^}]+\}\}/gu, ' ')
    .trim()
    .split(/\s+/u);

  return (
    variableCount > Math.max(1, Math.floor(words.filter(Boolean).length / 2))
  );
};

export const isValidUrl = (value: string) =>
  /^https?:\/\/\S+\.\S+/iu.test(value);

export const validateTemplateName = (
  draft: TemplateDraft
): ValidationMessage | null => {
  const name = draft.name.trim();
  if (!name) return { key: 'whatsapp_template_validation_name_required' };
  if (!/^[a-z0-9_]+$/u.test(name)) {
    return { key: 'whatsapp_template_validation_name_format' };
  }
  if (name.length > 512) {
    return {
      key: 'whatsapp_template_validation_name_max',
      params: { count: 512 },
    };
  }

  return null;
};

export const validateHeaderText = (
  draft: TemplateDraft,
  variables: string[]
): ValidationMessage | null => {
  if (draft.header_text.length > 60) {
    return {
      key: 'whatsapp_template_validation_header_max',
      params: { count: 60 },
    };
  }
  if (textStartsOrEndsWithVariable(draft.header_text)) {
    return { key: 'whatsapp_template_validation_header_variable_edges' };
  }
  if (variables.length > 1) {
    return { key: 'whatsapp_template_validation_header_variable_max' };
  }

  return null;
};

export const validateBodyText = (
  draft: TemplateDraft,
  variables: string[]
): ValidationMessage | null => {
  if (!draft.body_text.trim()) {
    return { key: 'whatsapp_template_validation_body_required' };
  }
  if (draft.body_text.length > 1024) {
    return {
      key: 'whatsapp_template_validation_body_max',
      params: { count: 1024 },
    };
  }
  if (textStartsOrEndsWithVariable(draft.body_text)) {
    return { key: 'whatsapp_template_validation_body_variable_edges' };
  }
  if (hasHighVariableDensity(draft.body_text, variables.length)) {
    return { key: 'whatsapp_template_validation_body_variable_density' };
  }

  return null;
};

export const validateFooterText = (
  draft: TemplateDraft
): ValidationMessage | null => {
  if (draft.footer_text.length > 60) {
    return {
      key: 'whatsapp_template_validation_footer_max',
      params: { count: 60 },
    };
  }

  return null;
};

export const validateSampleValues = (
  kind: 'header' | 'body',
  variables: string[],
  samples: Record<string, string>
): ValidationMessage[] =>
  variables
    .filter((variable) => !samples[variable]?.trim())
    .map((variable) => ({
      key:
        kind === 'header'
          ? 'whatsapp_template_validation_header_sample_required'
          : 'whatsapp_template_validation_body_sample_required',
      params: { variable: `{{${variable}}}` },
    }));

export const validateButton = (button: ButtonDraft): ValidationMessage[] => {
  const errors: ValidationMessage[] = [];

  if (button.type !== 'COPY_CODE' && !button.text.trim()) {
    errors.push({ key: 'whatsapp_template_validation_button_text_required' });
  }
  if (button.type !== 'COPY_CODE' && button.text.length > 40) {
    errors.push({
      key: 'whatsapp_template_validation_button_text_max',
      params: { count: 40 },
    });
  }
  if (button.type === 'URL') {
    if (!isValidUrl(button.url.trim())) {
      errors.push({ key: 'whatsapp_template_validation_url_required' });
    }
    if (
      (button.url_type === 'DYNAMIC' || button.url.includes('{{')) &&
      !button.url_example.trim()
    ) {
      errors.push({ key: 'whatsapp_template_validation_url_example_required' });
    }
    if (button.track_app_conversions) {
      if (!button.meta_app_id.trim()) {
        errors.push({ key: 'whatsapp_template_validation_meta_app_required' });
      }
      if (!button.android_deep_link.trim()) {
        errors.push({
          key: 'whatsapp_template_validation_android_deep_link_required',
        });
      }
      if (!isValidUrl(button.android_fallback_playstore_url.trim())) {
        errors.push({
          key: 'whatsapp_template_validation_android_fallback_required',
        });
      }
    }
  }
  if (
    button.type === 'PHONE_NUMBER' &&
    toE164Digits(button).replace(/\D/gu, '').length < 8
  ) {
    errors.push({ key: 'whatsapp_template_validation_phone_required' });
  }
  if (button.type === 'COPY_CODE' && !button.offer_code.trim()) {
    errors.push({ key: 'whatsapp_template_validation_offer_sample_required' });
  }
  if (button.type === 'COPY_CODE' && button.offer_code.length > 20) {
    errors.push({
      key: 'whatsapp_template_validation_offer_code_max',
      params: { count: 20 },
    });
  }
  if (button.type === 'VOICE_CALL' && !button.voice_call_ttl_minutes) {
    errors.push({ key: 'whatsapp_template_validation_voice_ttl_required' });
  }

  return errors;
};

export const validateButtonField = (
  button: ButtonDraft,
  field: ButtonField
): ValidationMessage[] => {
  if (field === 'text' && button.type !== 'COPY_CODE') {
    if (!button.text.trim()) {
      return [{ key: 'whatsapp_template_validation_button_text_required' }];
    }
    if (button.text.length > 40) {
      return [{ key: 'whatsapp_template_validation_max_40' }];
    }
  }
  if (field === 'url' && button.type === 'URL' && !isValidUrl(button.url)) {
    return [{ key: 'whatsapp_template_validation_url_short' }];
  }
  if (
    field === 'url_example' &&
    button.type === 'URL' &&
    (button.url_type === 'DYNAMIC' || button.url.includes('{{')) &&
    !button.url_example.trim()
  ) {
    return [{ key: 'whatsapp_template_validation_url_example_required' }];
  }
  if (
    field === 'phone_number' &&
    button.type === 'PHONE_NUMBER' &&
    toE164Digits(button).replace(/\D/gu, '').length < 8
  ) {
    return [{ key: 'whatsapp_template_validation_phone_short' }];
  }
  if (
    field === 'offer_code' &&
    button.type === 'COPY_CODE' &&
    !button.offer_code.trim()
  ) {
    return [{ key: 'whatsapp_template_validation_offer_sample_required' }];
  }
  if (
    field === 'meta_app_id' &&
    button.type === 'URL' &&
    button.track_app_conversions &&
    !button.meta_app_id.trim()
  ) {
    return [{ key: 'whatsapp_template_validation_meta_app_short' }];
  }
  if (
    field === 'android_deep_link' &&
    button.type === 'URL' &&
    button.track_app_conversions &&
    !button.android_deep_link.trim()
  ) {
    return [{ key: 'whatsapp_template_validation_android_deep_link_required' }];
  }
  if (
    field === 'android_fallback_playstore_url' &&
    button.type === 'URL' &&
    button.track_app_conversions &&
    !isValidUrl(button.android_fallback_playstore_url)
  ) {
    return [{ key: 'whatsapp_template_validation_url_short' }];
  }

  return [];
};

export const validateButtonLimits = (
  draft: TemplateDraft
): ValidationMessage[] => {
  const errors: ValidationMessage[] = [];
  const urlCount = draft.buttons.filter(
    (button) => button.type === 'URL'
  ).length;
  const phoneCount = draft.buttons.filter(
    (button) => button.type === 'PHONE_NUMBER'
  ).length;
  const voiceCallCount = draft.buttons.filter(
    (button) => button.type === 'VOICE_CALL'
  ).length;
  const copyCodeCount = draft.buttons.filter(
    (button) => button.type === 'COPY_CODE'
  ).length;

  if (draft.buttons.length > 10) {
    errors.push({ key: 'whatsapp_template_validation_buttons_max' });
  }
  if (urlCount > 2) {
    errors.push({ key: 'whatsapp_template_validation_url_buttons_max' });
  }
  if (phoneCount > 1) {
    errors.push({ key: 'whatsapp_template_validation_phone_buttons_max' });
  }
  if (voiceCallCount > 1) {
    errors.push({ key: 'whatsapp_template_validation_voice_buttons_max' });
  }
  if (copyCodeCount > 1) {
    errors.push({ key: 'whatsapp_template_validation_copy_buttons_max' });
  }

  return errors;
};
