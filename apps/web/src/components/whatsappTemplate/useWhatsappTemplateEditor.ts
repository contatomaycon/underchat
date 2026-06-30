import {
  computed,
  onUnmounted,
  reactive,
  shallowRef,
  watch,
  type Ref,
} from 'vue';
import type {
  CreateWhatsappTemplateRequest,
  UpdateWhatsappTemplateRequest,
  WhatsappTemplateResponse,
} from '@core/schema/worker/whatsappOfficialTemplate';
import {
  defaultButton,
  defaultMessageTtlSeconds,
  getCategoryOptions,
  getCountryCodeOptions,
  getCtaButtonTypes,
  getDefaultQuickReplyButtonText,
  getHeaderFormatOptions,
  getLanguageOptions,
  getMarketingStandardButtonTypes,
  getParameterFormatOptions,
  getQuickReplyTypeOptions,
  getSubtypeOptions,
  getTtlOptions,
  getUrlTypeOptions,
  getVoiceCallTtlOptions,
} from './constants';
import {
  appendWithSpace,
  asRecord,
  buildComponents,
  getVariables,
  makeNextVariable,
  parseNamedSamples,
  parseSampleArray,
  readFirstString,
  stripUrlVariableToken,
} from './payload';
import type {
  ButtonDraft,
  ButtonType,
  HeaderFormat,
  MediaAttachmentPreview,
  QuickReplyType,
  TemplateDraft,
  TranslateFn,
  UrlType,
  ValidationMessage,
} from './types';
import {
  type ButtonField,
  validateBodyText,
  validateButton,
  validateButtonField,
  validateButtonLimits,
  validateFooterText,
  validateHeaderMedia,
  validateHeaderText,
  validateSampleValues,
  validateTemplateName,
} from './validation';

interface UseWhatsappTemplateEditorOptions {
  template: Ref<WhatsappTemplateResponse | null>;
  uploadMedia: (file: File) => Promise<string | null>;
  save: (
    payload: CreateWhatsappTemplateRequest | UpdateWhatsappTemplateRequest
  ) => void;
  t: TranslateFn;
}

const defaultDraft = (t: TranslateFn): TemplateDraft => ({
  name: '',
  language: 'pt_BR',
  category: 'MARKETING',
  sub_category: 'STANDARD',
  parameter_format: 'POSITIONAL',
  header_format: 'NONE',
  header_text: '',
  header_handle: '',
  body_text: t('whatsapp_template_default_body'),
  footer_text: '',
  custom_ttl_enabled: false,
  message_send_ttl_seconds: defaultMessageTtlSeconds,
  header_variable_samples: {},
  body_variable_samples: {},
  buttons: [],
});

const translateMessage = (message: ValidationMessage | null, t: TranslateFn) =>
  message ? t(message.key, message.params) : '';

const translateMessages = (messages: ValidationMessage[], t: TranslateFn) =>
  messages.map((message) => t(message.key, message.params));

const mediaHeaderFormats: HeaderFormat[] = ['IMAGE', 'VIDEO', 'DOCUMENT'];

const isMediaHeaderFormat = (format: HeaderFormat) =>
  mediaHeaderFormats.includes(format);

const deepLinkFieldNames: ButtonField[] = [
  'meta_app_id',
  'android_deep_link',
  'android_fallback_playstore_url',
];

export const useWhatsappTemplateEditor = ({
  template,
  uploadMedia,
  save,
  t,
}: UseWhatsappTemplateEditorOptions) => {
  const currentStep = shallowRef(1);
  const selectedFile = shallowRef<File | File[] | null>(null);
  const mediaAttachmentName = shallowRef('');
  const mediaAttachmentUrl = shallowRef<string | null>(null);
  const mediaUploadAttempt = shallowRef(0);
  const isHydratingDraft = shallowRef(false);
  const draft = reactive<TemplateDraft>(defaultDraft(t));

  const languageOptions = computed(() => getLanguageOptions(t));
  const ttlOptions = computed(() => getTtlOptions(t));
  const countryCodeOptions = computed(() => getCountryCodeOptions(t));
  const categoryOptions = computed(() => getCategoryOptions(t));
  const subtypeOptions = computed(() => getSubtypeOptions(draft.category, t));
  const headerFormatOptions = computed(() => getHeaderFormatOptions(t));
  const parameterFormatOptions = computed(() => getParameterFormatOptions(t));
  const marketingStandardButtonTypes = computed(() =>
    getMarketingStandardButtonTypes(t)
  );
  const ctaButtonTypes = computed(() => getCtaButtonTypes(t));
  const quickReplyTypeOptions = computed(() => getQuickReplyTypeOptions(t));
  const urlTypeOptions = computed(() => getUrlTypeOptions(t));
  const voiceCallTtlOptions = computed(() => getVoiceCallTtlOptions(t));

  const isMarketingStandard = computed(
    () => draft.category === 'MARKETING' && draft.sub_category === 'STANDARD'
  );

  const isEditingRemote = computed(() =>
    Boolean(template.value?.meta_template_id)
  );

  const selectedLanguageTitle = computed(
    () =>
      languageOptions.value.find(
        (language) => language.value === draft.language
      )?.title ?? draft.language
  );

  const summarySubtitle = computed(() => {
    const category =
      categoryOptions.value.find((option) => option.value === draft.category)
        ?.title ?? draft.category;
    const subtype =
      subtypeOptions.value.find((option) => option.value === draft.sub_category)
        ?.title ?? draft.sub_category;

    return `${category} • ${subtype}`;
  });

  const mediaAttachment = computed<MediaAttachmentPreview | null>(() => {
    if (!isMediaHeaderFormat(draft.header_format)) return null;
    if (!draft.header_handle && !mediaAttachmentName.value) return null;

    return {
      name: mediaAttachmentName.value || t('whatsapp_template_media_uploaded'),
      url: mediaAttachmentUrl.value,
      format: draft.header_format,
    };
  });

  const revokeMediaAttachmentUrl = () => {
    if (mediaAttachmentUrl.value) {
      URL.revokeObjectURL(mediaAttachmentUrl.value);
      mediaAttachmentUrl.value = null;
    }
  };

  const resetMediaAttachment = () => {
    selectedFile.value = null;
    mediaAttachmentName.value = '';
    revokeMediaAttachmentUrl();
  };

  const removeMediaFile = () => {
    mediaUploadAttempt.value += 1;
    draft.header_handle = '';
    resetMediaAttachment();
  };

  const resetDraft = () => {
    mediaUploadAttempt.value += 1;
    resetMediaAttachment();
    Object.assign(draft, defaultDraft(t));
    currentStep.value = 1;
  };

  const splitPhone = (phone: string) => {
    const sanitized = phone.replace(/[^\d+]/gu, '');
    const knownCode = [...countryCodeOptions.value]
      .sort(
        (first, second) =>
          String(second.value).length - String(first.value).length
      )
      .find((option) =>
        sanitized.startsWith(String(option.value).replace('+', ''))
      );

    if (!knownCode) {
      return {
        country: '+55',
        number: sanitized.replace(/^\+/u, ''),
      };
    }

    const codeDigits = String(knownCode.value).replace('+', '');

    return {
      country: String(knownCode.value),
      number: sanitized.replace(/^\+/u, '').replace(codeDigits, ''),
    };
  };

  const parseTemplate = (nextTemplate: WhatsappTemplateResponse | null) => {
    isHydratingDraft.value = true;
    resetDraft();

    if (!nextTemplate) {
      isHydratingDraft.value = false;
      return;
    }

    draft.name = nextTemplate.name;
    draft.language = nextTemplate.language || 'pt_BR';
    draft.category = nextTemplate.category || 'MARKETING';
    draft.sub_category = nextTemplate.sub_category || 'STANDARD';
    draft.parameter_format =
      nextTemplate.parameter_format === 'NAMED' ? 'NAMED' : 'POSITIONAL';
    draft.custom_ttl_enabled = Boolean(nextTemplate.message_send_ttl_seconds);
    draft.message_send_ttl_seconds =
      nextTemplate.message_send_ttl_seconds ?? defaultMessageTtlSeconds;

    const header = nextTemplate.components.find(
      (component) => component.type === 'HEADER'
    );
    const body = nextTemplate.components.find(
      (component) => component.type === 'BODY'
    );
    const footer = nextTemplate.components.find(
      (component) => component.type === 'FOOTER'
    );
    const buttons = nextTemplate.components.find(
      (component) => component.type === 'BUTTONS'
    );

    draft.header_format = String(header?.format ?? 'NONE') as HeaderFormat;
    if (draft.header_format === 'TEXT') {
      draft.header_text = String(header?.text ?? '');
    }
    const headerExample = asRecord(header?.example);
    draft.header_handle = readFirstString(headerExample.header_handle);
    draft.header_variable_samples =
      draft.parameter_format === 'NAMED'
        ? parseNamedSamples(headerExample.header_text_named_params)
        : parseSampleArray(
            draft.header_text,
            headerExample.header_text,
            draft.parameter_format
          );

    draft.body_text = String(body?.text ?? t('whatsapp_template_default_body'));
    const bodyExample = asRecord(body?.example);
    draft.body_variable_samples =
      draft.parameter_format === 'NAMED'
        ? parseNamedSamples(bodyExample.body_text_named_params)
        : parseSampleArray(
            draft.body_text,
            Array.isArray(bodyExample.body_text)
              ? (bodyExample.body_text[0] as unknown[])
              : [],
            draft.parameter_format
          );
    draft.footer_text = String(footer?.text ?? '');
    draft.buttons = Array.isArray(buttons?.buttons)
      ? (buttons.buttons as Record<string, unknown>[])
          .filter((button) =>
            [
              'QUICK_REPLY',
              'URL',
              'PHONE_NUMBER',
              'VOICE_CALL',
              'COPY_CODE',
            ].includes(String(button.type))
          )
          .map((button) => {
            const type = String(button.type) as ButtonType;
            const phone = splitPhone(String(button.phone_number ?? ''));
            const appDeepLink = asRecord(button.app_deep_link);
            const example = readFirstString(button.example);

            return {
              ...defaultButton(t, type),
              text: String(button.text ?? defaultButton(t, type).text),
              url: stripUrlVariableToken(String(button.url ?? '')),
              url_type:
                String(button.url ?? '').includes('{{') || example
                  ? 'DYNAMIC'
                  : 'STATIC',
              url_example: type === 'URL' ? example : '',
              phone_country_code: phone.country,
              phone_number: phone.number,
              offer_code: type === 'COPY_CODE' ? example : '',
              track_app_conversions: Object.keys(appDeepLink).length > 0,
              meta_app_id: String(appDeepLink.meta_app_id ?? ''),
              android_deep_link: stripUrlVariableToken(
                String(appDeepLink.android_deep_link ?? '')
              ),
              android_fallback_playstore_url: stripUrlVariableToken(
                String(appDeepLink.android_fallback_playstore_url ?? '')
              ),
              voice_call_ttl_minutes:
                typeof button.ttl_minutes === 'number'
                  ? button.ttl_minutes
                  : defaultButton(t, type).voice_call_ttl_minutes,
            };
          })
      : [];
    isHydratingDraft.value = false;
  };

  watch(template, (nextTemplate) => parseTemplate(nextTemplate), {
    immediate: true,
  });

  watch(
    () => draft.category,
    () => {
      if (isHydratingDraft.value) return;
      draft.sub_category = subtypeOptions.value[0]?.value ?? null;
      if (draft.category === 'AUTHENTICATION' && !draft.body_text) {
        draft.body_text = t('whatsapp_template_authentication_default_body', {
          code: '{{1}}',
        });
      }
    },
    { flush: 'sync' }
  );

  watch(
    () => draft.parameter_format,
    () => {
      draft.header_variable_samples = {};
      draft.body_variable_samples = {};
    }
  );

  watch(
    () => draft.header_format,
    (headerFormat, previousHeaderFormat) => {
      if (isHydratingDraft.value) return;

      if (headerFormat !== previousHeaderFormat) {
        removeMediaFile();
      }
    }
  );

  watch(
    () => draft.custom_ttl_enabled,
    (enabled) => {
      if (enabled && !draft.message_send_ttl_seconds) {
        draft.message_send_ttl_seconds = defaultMessageTtlSeconds;
      }
    }
  );

  const headerVariables = computed(() =>
    getVariables(draft.header_text, draft.parameter_format)
  );

  const bodyVariables = computed(() =>
    getVariables(draft.body_text, draft.parameter_format)
  );

  watch(
    headerVariables,
    (variables) => {
      const next: Record<string, string> = {};
      variables.forEach((variable) => {
        next[variable] = draft.header_variable_samples[variable] ?? '';
      });
      draft.header_variable_samples = next;
    },
    { immediate: true }
  );

  watch(
    bodyVariables,
    (variables) => {
      const next: Record<string, string> = {};
      variables.forEach((variable) => {
        next[variable] = draft.body_variable_samples[variable] ?? '';
      });
      draft.body_variable_samples = next;
    },
    { immediate: true }
  );

  const components = computed(() => buildComponents(draft, t));

  const quickReplyButtonEntries = computed(() =>
    draft.buttons
      .map((button, index) => ({ button, index }))
      .filter((entry) => entry.button.type === 'QUICK_REPLY')
  );

  const ctaButtonEntries = computed(() =>
    draft.buttons
      .map((button, index) => ({ button, index }))
      .filter((entry) => entry.button.type !== 'QUICK_REPLY')
  );

  const canContinueConfig = computed(() =>
    Boolean(draft.category && draft.sub_category)
  );

  const templateNameValidation = computed(() => validateTemplateName(draft));
  const headerTextValidation = computed(() =>
    validateHeaderText(draft, headerVariables.value)
  );
  const headerMediaValidation = computed(() =>
    validateHeaderMedia(draft.header_format, draft.header_handle)
  );
  const bodyTextValidation = computed(() =>
    validateBodyText(draft, bodyVariables.value)
  );
  const footerTextValidation = computed(() => validateFooterText(draft));

  const templateNameError = computed(() =>
    translateMessage(templateNameValidation.value, t)
  );
  const headerTextError = computed(() =>
    translateMessage(headerTextValidation.value, t)
  );
  const headerMediaError = computed(() =>
    translateMessage(headerMediaValidation.value, t)
  );
  const bodyTextError = computed(() =>
    translateMessage(bodyTextValidation.value, t)
  );
  const footerTextError = computed(() =>
    translateMessage(footerTextValidation.value, t)
  );
  const headerSampleErrors = computed(() =>
    validateSampleValues(
      'header',
      headerVariables.value,
      draft.header_variable_samples
    )
  );
  const bodySampleErrors = computed(() =>
    validateSampleValues(
      'body',
      bodyVariables.value,
      draft.body_variable_samples
    )
  );
  const buttonLimitValidationErrors = computed(() =>
    validateButtonLimits(draft)
  );
  const buttonLimitErrors = computed(() =>
    translateMessages(buttonLimitValidationErrors.value, t)
  );

  const validationMessages = computed(() => [
    ...(templateNameValidation.value ? [templateNameValidation.value] : []),
    ...(headerTextValidation.value ? [headerTextValidation.value] : []),
    ...(headerMediaValidation.value ? [headerMediaValidation.value] : []),
    ...(bodyTextValidation.value ? [bodyTextValidation.value] : []),
    ...(footerTextValidation.value ? [footerTextValidation.value] : []),
    ...headerSampleErrors.value,
    ...bodySampleErrors.value,
    ...buttonLimitValidationErrors.value,
    ...draft.buttons.flatMap((button) => validateButton(button)),
  ]);

  const validationErrors = computed(() =>
    translateMessages(validationMessages.value, t)
  );
  const firstValidationError = computed(() => validationErrors.value[0] ?? '');
  const canSubmit = computed(() => validationErrors.value.length === 0);

  const buttonFieldErrors = (button: ButtonDraft, field: ButtonField) => {
    if (deepLinkFieldNames.includes(field)) {
      return [];
    }

    return translateMessages(validateButtonField(button, field), t);
  };

  const isSupportedButtonType = (type: ButtonType) =>
    marketingStandardButtonTypes.value.some((option) => option.value === type);

  const countButtonsByType = (type: ButtonType, exceptIndex?: number) =>
    draft.buttons.filter(
      (button, buttonIndex) =>
        button.type === type && buttonIndex !== exceptIndex
    ).length;

  const getButtonTypeLimit = (type: ButtonType) => {
    if (type === 'URL') return 2;
    if (type === 'PHONE_NUMBER') return 1;
    if (type === 'VOICE_CALL') return 1;
    if (type === 'COPY_CODE') return 1;

    return 10;
  };

  const canUseButtonType = (type: ButtonType, exceptIndex?: number) => {
    if (!isSupportedButtonType(type)) return false;

    return countButtonsByType(type, exceptIndex) < getButtonTypeLimit(type);
  };

  const canAddButtonType = (type: ButtonType) =>
    draft.buttons.length < 10 && canUseButtonType(type);

  const addButton = (type: ButtonType = 'QUICK_REPLY') => {
    if (!canAddButtonType(type)) return;
    if (
      !marketingStandardButtonTypes.value.some(
        (option) => option.value === type
      )
    ) {
      return;
    }

    draft.buttons.push(defaultButton(t, type));
  };

  const removeButton = (index: number) => {
    draft.buttons.splice(index, 1);
  };

  const reorderButton = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;

    const targetButton = draft.buttons[toIndex];
    const movingButton = draft.buttons[fromIndex];

    if (!targetButton || !movingButton) return;

    const [removedButton] = draft.buttons.splice(fromIndex, 1);

    if (!removedButton) return;

    draft.buttons.splice(toIndex, 0, removedButton);
  };

  const updateButtonType = (index: number, type: ButtonType) => {
    if (
      !marketingStandardButtonTypes.value.some(
        (option) => option.value === type
      )
    ) {
      return;
    }

    const existingButton = draft.buttons[index];
    if (!existingButton || existingButton.type === type) return;

    if (!canUseButtonType(type, index)) {
      return;
    }

    draft.buttons.splice(index, 1, defaultButton(t, type));
  };

  const updateQuickReplyType = (
    index: number,
    quickReplyType: QuickReplyType
  ) => {
    const button = draft.buttons[index];

    if (
      !button ||
      button.type !== 'QUICK_REPLY' ||
      button.quick_reply_type === quickReplyType
    ) {
      return;
    }

    const currentDefaultText = getDefaultQuickReplyButtonText(
      button.quick_reply_type,
      t
    );
    const shouldReplaceText =
      !button.text.trim() || button.text === currentDefaultText;

    button.quick_reply_type = quickReplyType;

    if (shouldReplaceText) {
      button.text = getDefaultQuickReplyButtonText(quickReplyType, t);
    }
  };

  const insertHeaderVariable = () => {
    if (getVariables(draft.header_text, draft.parameter_format).length >= 1) {
      return;
    }

    draft.header_text = appendWithSpace(
      draft.header_text,
      makeNextVariable(draft.header_text, draft.parameter_format)
    );
  };

  const insertBodyVariable = () => {
    draft.body_text = appendWithSpace(
      draft.body_text,
      makeNextVariable(draft.body_text, draft.parameter_format)
    );
  };

  const insertBodyMarkup = (markup: string) => {
    draft.body_text = appendWithSpace(draft.body_text, markup);
  };

  const updateUrlType = (index: number, urlType: UrlType) => {
    const button = draft.buttons[index];
    if (!button || button.type !== 'URL') return;

    button.url_type = urlType;
    button.url = stripUrlVariableToken(button.url);
    button.android_deep_link = stripUrlVariableToken(button.android_deep_link);
    button.android_fallback_playstore_url = stripUrlVariableToken(
      button.android_fallback_playstore_url
    );
  };

  const handleMediaFile = async (value: File | File[] | null) => {
    selectedFile.value = value;
    const file = Array.isArray(value) ? value[0] : value;
    if (!file) {
      removeMediaFile();
      return;
    }

    mediaUploadAttempt.value += 1;
    const uploadAttempt = mediaUploadAttempt.value;
    draft.header_handle = '';
    mediaAttachmentName.value = file.name;
    revokeMediaAttachmentUrl();
    mediaAttachmentUrl.value = URL.createObjectURL(file);
    const handle = await uploadMedia(file);
    if (uploadAttempt === mediaUploadAttempt.value && handle) {
      draft.header_handle = handle;
    }
  };

  onUnmounted(revokeMediaAttachmentUrl);

  const submit = () => {
    if (!canSubmit.value) return;

    save({
      name: draft.name.trim(),
      language: draft.language,
      category: draft.category as CreateWhatsappTemplateRequest['category'],
      sub_category: draft.sub_category,
      parameter_format: draft.parameter_format,
      components: components.value,
      message_send_ttl_seconds: draft.custom_ttl_enabled
        ? draft.message_send_ttl_seconds
        : null,
    });
  };

  return {
    bodyTextError,
    bodyVariables,
    buttonFieldErrors,
    buttonLimitErrors,
    canAddButtonType,
    canUseButtonType,
    canContinueConfig,
    canSubmit,
    categoryOptions,
    components,
    countryCodeOptions,
    ctaButtonEntries,
    ctaButtonTypes,
    currentStep,
    draft,
    footerTextError,
    handleMediaFile,
    headerMediaError,
    headerFormatOptions,
    headerTextError,
    headerVariables,
    insertBodyMarkup,
    insertBodyVariable,
    insertHeaderVariable,
    isEditingRemote,
    isMarketingStandard,
    languageOptions,
    marketingStandardButtonTypes,
    mediaAttachment,
    parameterFormatOptions,
    quickReplyButtonEntries,
    quickReplyTypeOptions,
    removeMediaFile,
    removeButton,
    reorderButton,
    selectedLanguageTitle,
    submit,
    subtypeOptions,
    summarySubtitle,
    templateNameError,
    ttlOptions,
    urlTypeOptions,
    validationErrors,
    firstValidationError,
    voiceCallTtlOptions,
    updateButtonType,
    updateQuickReplyType,
    updateUrlType,
    addButton,
  };
};
