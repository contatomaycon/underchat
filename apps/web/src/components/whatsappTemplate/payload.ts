import type { WhatsappTemplateComponent } from '@core/schema/worker/whatsappOfficialTemplate';
import { getDefaultButtonText } from './constants';
import type {
  ButtonDraft,
  ParameterFormat,
  TemplateDraft,
  TranslateFn,
} from './types';

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

export const readFirstString = (value: unknown): string => {
  if (Array.isArray(value)) return String(value[0] ?? '');

  return String(value ?? '');
};

export const getVariables = (text: string, format: ParameterFormat) => {
  const pattern =
    format === 'NAMED'
      ? /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/gu
      : /\{\{(\d+)\}\}/gu;
  const variables: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    const variable = match[1];
    if (!variables.includes(variable)) variables.push(variable);
  }

  if (format === 'POSITIONAL') {
    return variables.sort((first, second) => Number(first) - Number(second));
  }

  return variables;
};

export const makeNextVariable = (
  text: string,
  parameterFormat: ParameterFormat
) => {
  if (parameterFormat === 'NAMED') {
    const base = 'nome';
    const variables = getVariables(text, 'NAMED');
    if (!variables.includes(base)) return `{{${base}}}`;

    return `{{campo_${variables.length + 1}}}`;
  }

  const numericVariables = getVariables(text, 'POSITIONAL').map(Number);
  const nextIndex = Math.max(0, ...numericVariables) + 1;

  return `{{${nextIndex}}}`;
};

export const appendWithSpace = (text: string, value: string) =>
  `${text}${text && !text.endsWith(' ') ? ' ' : ''}${value}`;

export const parseSampleArray = (
  text: string,
  samples: unknown,
  format: ParameterFormat
) => {
  const next: Record<string, string> = {};
  const variables = getVariables(text, format);
  const sampleArray = Array.isArray(samples) ? samples : [];

  variables.forEach((variable, index) => {
    next[variable] = String(sampleArray[index] ?? '');
  });

  return next;
};

export const parseNamedSamples = (value: unknown) => {
  const next: Record<string, string> = {};
  if (!Array.isArray(value)) return next;

  value.forEach((item) => {
    const record = asRecord(item);
    const name = String(record.param_name ?? '');
    if (!name) return;
    next[name] = String(record.example ?? '');
  });

  return next;
};

export const toE164Digits = (button: ButtonDraft) =>
  `${button.phone_country_code}${button.phone_number}`
    .replace(/[^\d+]/gu, '')
    .replace(/^\+/u, '');

const buildTextExample = (
  draft: TemplateDraft,
  kind: 'header' | 'body',
  variables: string[],
  samples: Record<string, string>
) => {
  if (!variables.length) return undefined;

  if (draft.parameter_format === 'NAMED') {
    return {
      [`${kind}_text_named_params`]: variables.map((variable) => ({
        param_name: variable,
        example: samples[variable]?.trim(),
      })),
    };
  }

  if (kind === 'header') {
    return {
      header_text: variables.map((variable) => samples[variable]?.trim()),
    };
  }

  return {
    body_text: [variables.map((variable) => samples[variable]?.trim())],
  };
};

export const buildHeaderComponent = (
  draft: TemplateDraft
): WhatsappTemplateComponent | null => {
  if (draft.header_format === 'NONE' && !draft.header_text.trim()) return null;

  if (draft.header_format === 'NONE' || draft.header_format === 'TEXT') {
    if (!draft.header_text.trim()) return null;

    const example = buildTextExample(
      draft,
      'header',
      getVariables(draft.header_text, draft.parameter_format),
      draft.header_variable_samples
    );

    return {
      type: 'HEADER',
      format: 'TEXT',
      text: draft.header_text.trim(),
      ...(example ? { example } : {}),
    };
  }

  if (draft.header_format === 'LOCATION') {
    return { type: 'HEADER', format: 'LOCATION' };
  }

  return {
    type: 'HEADER',
    format: draft.header_format,
    ...(draft.header_handle.trim()
      ? {
          example: {
            header_handle: [draft.header_handle.trim()],
          },
        }
      : {}),
  };
};

export const buildBodyComponent = (
  draft: TemplateDraft
): WhatsappTemplateComponent => {
  const example = buildTextExample(
    draft,
    'body',
    getVariables(draft.body_text, draft.parameter_format),
    draft.body_variable_samples
  );

  return {
    type: 'BODY',
    text: draft.body_text.trim(),
    ...(example ? { example } : {}),
  };
};

export const buildFooterComponent = (
  draft: TemplateDraft
): WhatsappTemplateComponent | null =>
  draft.footer_text.trim()
    ? {
        type: 'FOOTER',
        text: draft.footer_text.trim(),
      }
    : null;

export const buildButtonPayloads = (draft: TemplateDraft, t: TranslateFn) =>
  draft.buttons.map((button) => {
    if (button.type === 'COPY_CODE') {
      return {
        type: 'COPY_CODE',
        example: button.offer_code.trim(),
      };
    }

    const payload: Record<string, unknown> = {
      type: button.type,
      text: button.text.trim() || getDefaultButtonText(button.type, t),
    };

    if (button.type === 'QUICK_REPLY') return payload;

    if (button.type === 'URL') {
      payload.url = button.url.trim();
      if (button.url_type === 'DYNAMIC' || button.url.includes('{{')) {
        payload.example = [button.url_example.trim()];
      }
      if (button.track_app_conversions) {
        payload.app_deep_link = {
          meta_app_id: button.meta_app_id.trim(),
          android_deep_link: button.android_deep_link.trim(),
          android_fallback_playstore_url:
            button.android_fallback_playstore_url.trim(),
        };
      }
    }

    if (button.type === 'PHONE_NUMBER') {
      payload.phone_number = toE164Digits(button);
    }

    if (button.type === 'VOICE_CALL') {
      payload.ttl_minutes = button.voice_call_ttl_minutes;
    }

    return payload;
  });

export const buildComponents = (
  draft: TemplateDraft,
  t: TranslateFn
): WhatsappTemplateComponent[] => {
  const nextComponents: WhatsappTemplateComponent[] = [];
  const headerComponent = buildHeaderComponent(draft);
  const footerComponent = buildFooterComponent(draft);
  const buttons = buildButtonPayloads(draft, t);

  if (headerComponent) nextComponents.push(headerComponent);
  nextComponents.push(buildBodyComponent(draft));
  if (footerComponent) nextComponents.push(footerComponent);
  if (buttons.length) {
    nextComponents.push({
      type: 'BUTTONS',
      buttons,
    });
  }

  return nextComponents;
};
