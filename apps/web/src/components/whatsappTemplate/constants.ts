import type {
  ButtonDraft,
  ButtonType,
  HeaderFormat,
  ParameterFormat,
  QuickReplyType,
  SelectOption,
  TranslateFn,
  UrlType,
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
  { country: 'AF', value: '+93' },
  { country: 'AL', value: '+355' },
  { country: 'DZ', value: '+213' },
  { country: 'AD', value: '+376' },
  { country: 'AO', value: '+244' },
  { country: 'AR', value: '+54' },
  { country: 'AM', value: '+374' },
  { country: 'AU', value: '+61' },
  { country: 'AT', value: '+43' },
  { country: 'AZ', value: '+994' },
  { country: 'BH', value: '+973' },
  { country: 'BD', value: '+880' },
  { country: 'BE', value: '+32' },
  { country: 'BJ', value: '+229' },
  { country: 'BO', value: '+591' },
  { country: 'BA', value: '+387' },
  { country: 'BR', value: '+55' },
  { country: 'BG', value: '+359' },
  { country: 'US', value: '+1' },
  { country: 'CA', value: '+1' },
  { country: 'CL', value: '+56' },
  { country: 'CN', value: '+86' },
  { country: 'CO', value: '+57' },
  { country: 'CR', value: '+506' },
  { country: 'HR', value: '+385' },
  { country: 'CY', value: '+357' },
  { country: 'CZ', value: '+420' },
  { country: 'DK', value: '+45' },
  { country: 'DO', value: '+1' },
  { country: 'EC', value: '+593' },
  { country: 'EG', value: '+20' },
  { country: 'SV', value: '+503' },
  { country: 'EE', value: '+372' },
  { country: 'FI', value: '+358' },
  { country: 'FR', value: '+33' },
  { country: 'GE', value: '+995' },
  { country: 'DE', value: '+49' },
  { country: 'GH', value: '+233' },
  { country: 'GR', value: '+30' },
  { country: 'GT', value: '+502' },
  { country: 'HN', value: '+504' },
  { country: 'HK', value: '+852' },
  { country: 'HU', value: '+36' },
  { country: 'IS', value: '+354' },
  { country: 'IN', value: '+91' },
  { country: 'ID', value: '+62' },
  { country: 'IE', value: '+353' },
  { country: 'IL', value: '+972' },
  { country: 'IT', value: '+39' },
  { country: 'JP', value: '+81' },
  { country: 'JO', value: '+962' },
  { country: 'KZ', value: '+7' },
  { country: 'KE', value: '+254' },
  { country: 'KW', value: '+965' },
  { country: 'LV', value: '+371' },
  { country: 'LB', value: '+961' },
  { country: 'LT', value: '+370' },
  { country: 'LU', value: '+352' },
  { country: 'MY', value: '+60' },
  { country: 'MT', value: '+356' },
  { country: 'MX', value: '+52' },
  { country: 'MA', value: '+212' },
  { country: 'NL', value: '+31' },
  { country: 'NZ', value: '+64' },
  { country: 'NI', value: '+505' },
  { country: 'NG', value: '+234' },
  { country: 'NO', value: '+47' },
  { country: 'OM', value: '+968' },
  { country: 'PK', value: '+92' },
  { country: 'PA', value: '+507' },
  { country: 'PY', value: '+595' },
  { country: 'PE', value: '+51' },
  { country: 'PH', value: '+63' },
  { country: 'PL', value: '+48' },
  { country: 'PT', value: '+351' },
  { country: 'QA', value: '+974' },
  { country: 'RO', value: '+40' },
  { country: 'SA', value: '+966' },
  { country: 'RS', value: '+381' },
  { country: 'SG', value: '+65' },
  { country: 'SK', value: '+421' },
  { country: 'SI', value: '+386' },
  { country: 'ZA', value: '+27' },
  { country: 'KR', value: '+82' },
  { country: 'ES', value: '+34' },
  { country: 'SE', value: '+46' },
  { country: 'CH', value: '+41' },
  { country: 'TW', value: '+886' },
  { country: 'TH', value: '+66' },
  { country: 'TN', value: '+216' },
  { country: 'TR', value: '+90' },
  { country: 'UA', value: '+380' },
  { country: 'AE', value: '+971' },
  { country: 'GB', value: '+44' },
  { country: 'UY', value: '+598' },
  { country: 'UZ', value: '+998' },
  { country: 'VE', value: '+58' },
  { country: 'VN', value: '+84' },
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
  { title: t('whatsapp_template_ttl_168_hours'), value: 168 * 60 * 60 },
  ...Array.from({ length: 23 }, (_, index) => {
    const days = index + 8;

    return {
      title: t('whatsapp_template_ttl_days', { count: days }),
      value: days * 24 * 60 * 60,
    };
  }),
];

export const getCountryCodeOptions = (t: TranslateFn): SelectOption[] =>
  countryCodeSpecs.map((option) => ({
    title: t('whatsapp_template_country_option', {
      code: option.value,
      country: option.country,
    }),
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
  { title: t('whatsapp_template_button_call_whatsapp'), value: 'VOICE_CALL' },
  { title: t('whatsapp_template_button_call_phone'), value: 'PHONE_NUMBER' },
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

export const getUrlTypeOptions = (t: TranslateFn): SelectOption<UrlType>[] => [
  { title: t('whatsapp_template_url_type_static'), value: 'STATIC' },
  { title: t('whatsapp_template_url_type_dynamic'), value: 'DYNAMIC' },
];

export const getVoiceCallTtlOptions = (
  t: TranslateFn
): SelectOption<number>[] =>
  Array.from({ length: 30 }, (_, index) => {
    const days = index + 1;

    return {
      title:
        days === 1
          ? t('whatsapp_template_voice_ttl_1_day')
          : t('whatsapp_template_voice_ttl_days', { count: days }),
      value: days * 24 * 60,
    };
  });

export const getButtonIcon = (type: ButtonType | string) => {
  if (type === 'QUICK_REPLY') return 'tabler-arrow-back-up';
  if (type === 'URL') return 'tabler-external-link';
  if (type === 'PHONE_NUMBER') return 'tabler-phone';
  if (type === 'VOICE_CALL') return 'tabler-phone-call';
  if (type === 'COPY_CODE') return 'tabler-copy';

  return 'tabler-arrow-back-up';
};

export const getDefaultQuickReplyButtonText = (
  quickReplyType: QuickReplyType,
  t: TranslateFn
) =>
  quickReplyType === 'PRESET'
    ? t('whatsapp_template_button_default_preconfigured_response')
    : t('whatsapp_template_button_default_quick_reply');

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

  return getDefaultQuickReplyButtonText('CUSTOM', t);
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
