import type {
  ButtonDraft,
  ButtonType,
  HeaderFormat,
  ParameterFormat,
  SelectOption,
  TranslateFn,
} from './types';

const languageCodes = [
  'af',
  'sq',
  'ar',
  'ar_EG',
  'ar_AE',
  'ar_LB',
  'ar_MA',
  'ar_QA',
  'az',
  'be_BY',
  'bn',
  'bg',
  'ca',
  'zh_CN',
  'zh_HK',
  'zh_TW',
  'hr',
  'cs',
  'da',
  'nl',
  'en',
  'en_GB',
  'en_US',
  'et',
  'fil',
  'fi',
  'fr',
  'ka',
  'de',
  'el',
  'gu',
  'ha',
  'he',
  'hi',
  'hu',
  'id',
  'ga',
  'it',
  'ja',
  'kn',
  'kk',
  'rw_RW',
  'ko',
  'ky_KG',
  'lo',
  'lv',
  'lt',
  'mk',
  'ms',
  'ml',
  'mr',
  'nb',
  'fa',
  'pl',
  'pt_BR',
  'pt_PT',
  'pa',
  'ro',
  'ru',
  'sr',
  'sk',
  'sl',
  'es',
  'es_AR',
  'es_ES',
  'es_MX',
  'sw',
  'sv',
  'ta',
  'te',
  'th',
  'tr',
  'uk',
  'ur',
  'uz',
  'vi',
  'zu',
] as const;

const countryCodeSpecs = [
  { key: 'br', value: '+55' },
  { key: 'us', value: '+1' },
  { key: 'pt', value: '+351' },
  { key: 'es', value: '+34' },
  { key: 'mx', value: '+52' },
  { key: 'ar', value: '+54' },
] as const;

export const defaultMessageTtlSeconds = 12 * 60 * 60;
export const defaultVoiceCallTtlMinutes = 7 * 24 * 60;

const languageKey = (code: string) =>
  `whatsapp_template_language_${code.replace(/[^a-zA-Z0-9]/gu, '_')}`;

export const getLanguageOptions = (t: TranslateFn): SelectOption[] =>
  languageCodes.map((code) => ({
    title: t(languageKey(code)),
    value: code,
  }));

export const getTtlOptions = (t: TranslateFn): SelectOption<number>[] => [
  { title: t('whatsapp_template_ttl_12_hours'), value: 12 * 60 * 60 },
  { title: t('whatsapp_template_ttl_24_hours'), value: 24 * 60 * 60 },
  { title: t('whatsapp_template_ttl_48_hours'), value: 48 * 60 * 60 },
  { title: t('whatsapp_template_ttl_72_hours'), value: 72 * 60 * 60 },
  { title: t('whatsapp_template_ttl_96_hours'), value: 96 * 60 * 60 },
  ...Array.from({ length: 26 }, (_, index) => {
    const days = index + 5;

    return {
      title: t('whatsapp_template_ttl_days', { count: days }),
      value: days * 24 * 60 * 60,
    };
  }),
];

export const getCountryCodeOptions = (t: TranslateFn): SelectOption[] =>
  countryCodeSpecs.map((option) => ({
    title: t(`whatsapp_template_country_${option.key}`),
    value: option.value,
  }));

export const getCategoryOptions = (t: TranslateFn): SelectOption[] => [
  {
    title: t('whatsapp_template_category_marketing'),
    value: 'MARKETING',
    icon: 'tabler-speakerphone',
    description: t('whatsapp_template_category_marketing_description'),
  },
  {
    title: t('whatsapp_template_category_utility'),
    value: 'UTILITY',
    icon: 'tabler-bell',
    description: t('whatsapp_template_category_utility_description'),
  },
  {
    title: t('whatsapp_template_category_authentication'),
    value: 'AUTHENTICATION',
    icon: 'tabler-key',
    description: t('whatsapp_template_category_authentication_description'),
  },
];

export const getSubtypeOptions = (
  category: string,
  t: TranslateFn
): SelectOption[] => {
  if (category === 'AUTHENTICATION') {
    return [
      {
        title: t('whatsapp_template_subtype_one_time_passcode'),
        value: 'ONE_TIME_PASSCODE',
        description: t(
          'whatsapp_template_subtype_one_time_passcode_description'
        ),
      },
    ];
  }

  if (category === 'UTILITY') {
    return [
      {
        title: t('whatsapp_template_subtype_standard'),
        value: 'STANDARD',
        description: t(
          'whatsapp_template_subtype_utility_standard_description'
        ),
      },
      {
        title: t('whatsapp_template_subtype_order_status'),
        value: 'ORDER_STATUS',
        description: t('whatsapp_template_subtype_order_status_description'),
      },
      {
        title: t('whatsapp_template_subtype_order_details'),
        value: 'ORDER_DETAILS',
        description: t('whatsapp_template_subtype_order_details_description'),
      },
      {
        title: t('whatsapp_template_subtype_call_permissions'),
        value: 'CALL_PERMISSIONS_REQUEST',
        description: t(
          'whatsapp_template_subtype_utility_call_permissions_description'
        ),
      },
    ];
  }

  return [
    {
      title: t('whatsapp_template_subtype_standard'),
      value: 'STANDARD',
      description: t(
        'whatsapp_template_subtype_marketing_standard_description'
      ),
    },
    {
      title: t('whatsapp_template_subtype_catalog'),
      value: 'CATALOG',
      description: t('whatsapp_template_subtype_catalog_description'),
    },
    {
      title: t('whatsapp_template_subtype_order_details'),
      value: 'ORDER_DETAILS',
      description: t('whatsapp_template_subtype_marketing_order_description'),
    },
    {
      title: t('whatsapp_template_subtype_call_permissions'),
      value: 'CALL_PERMISSIONS_REQUEST',
      description: t(
        'whatsapp_template_subtype_marketing_call_permissions_description'
      ),
    },
  ];
};

export const getHeaderFormatOptions = (
  t: TranslateFn
): SelectOption<HeaderFormat>[] => [
  { title: t('whatsapp_template_header_none'), value: 'NONE' },
  { title: t('whatsapp_template_header_image'), value: 'IMAGE' },
  { title: t('whatsapp_template_header_video'), value: 'VIDEO' },
  { title: t('whatsapp_template_header_document'), value: 'DOCUMENT' },
  { title: t('whatsapp_template_header_location'), value: 'LOCATION' },
];

export const getParameterFormatOptions = (
  t: TranslateFn
): SelectOption<ParameterFormat>[] => [
  { title: t('whatsapp_template_parameter_number'), value: 'POSITIONAL' },
  { title: t('whatsapp_template_parameter_name'), value: 'NAMED' },
];

export const getMarketingStandardButtonTypes = (
  t: TranslateFn
): SelectOption<ButtonType>[] => [
  { title: t('whatsapp_template_button_quick_reply'), value: 'QUICK_REPLY' },
  { title: t('whatsapp_template_button_open_website'), value: 'URL' },
  { title: t('whatsapp_template_button_call_phone'), value: 'PHONE_NUMBER' },
  { title: t('whatsapp_template_button_call_whatsapp'), value: 'VOICE_CALL' },
  { title: t('whatsapp_template_button_copy_code'), value: 'COPY_CODE' },
];

export const getCtaButtonTypes = (t: TranslateFn): SelectOption<ButtonType>[] =>
  getMarketingStandardButtonTypes(t).filter(
    (option) => option.value !== 'QUICK_REPLY'
  );

export const getQuickReplyTypeOptions = (t: TranslateFn): SelectOption[] => [
  { title: t('whatsapp_template_quick_reply_custom'), value: 'CUSTOM' },
  { title: t('whatsapp_template_quick_reply_preset'), value: 'PRESET' },
];

export const getUrlTypeOptions = (t: TranslateFn): SelectOption[] => [
  { title: t('whatsapp_template_url_type_static'), value: 'STATIC' },
  { title: t('whatsapp_template_url_type_dynamic'), value: 'DYNAMIC' },
];

export const getVoiceCallTtlOptions = (
  t: TranslateFn
): SelectOption<number>[] => [
  { title: t('whatsapp_template_voice_ttl_1_day'), value: 1440 },
  { title: t('whatsapp_template_voice_ttl_3_days'), value: 4320 },
  { title: t('whatsapp_template_voice_ttl_7_days'), value: 10080 },
  { title: t('whatsapp_template_voice_ttl_14_days'), value: 20160 },
  { title: t('whatsapp_template_voice_ttl_30_days'), value: 43200 },
];

export const getButtonIcon = (type: ButtonType | string) => {
  if (type === 'QUICK_REPLY') return 'tabler-arrow-back-up';
  if (type === 'URL') return 'tabler-external-link';
  if (type === 'PHONE_NUMBER') return 'tabler-phone';
  if (type === 'VOICE_CALL') return 'tabler-phone-call';
  if (type === 'COPY_CODE') return 'tabler-copy';

  return 'tabler-arrow-back-up';
};

export const getDefaultButtonText = (type: ButtonType, t: TranslateFn) => {
  if (type === 'URL') return t('whatsapp_template_button_default_url');
  if (type === 'PHONE_NUMBER') {
    return t('whatsapp_template_button_default_phone');
  }
  if (type === 'VOICE_CALL') {
    return t('whatsapp_template_button_default_voice');
  }
  if (type === 'COPY_CODE') {
    return t('whatsapp_template_button_default_copy_code');
  }

  return t('whatsapp_template_button_default_quick_reply');
};

export const defaultButton = (
  t: TranslateFn,
  type: ButtonType = 'QUICK_REPLY'
): ButtonDraft => ({
  type,
  text: getDefaultButtonText(type, t),
  url: '',
  url_type: 'STATIC',
  url_example: '',
  phone_country_code: '+55',
  phone_number: '',
  offer_code: '',
  quick_reply_type: 'CUSTOM',
  track_app_conversions: false,
  meta_app_id: '',
  android_deep_link: '',
  android_fallback_playstore_url: '',
  voice_call_ttl_minutes: defaultVoiceCallTtlMinutes,
});
