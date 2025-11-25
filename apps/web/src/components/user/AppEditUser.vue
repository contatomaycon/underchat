<script lang="ts" setup>
import { nextTick, computed, watch, onMounted } from 'vue';
import { useUsersStore } from '@/@webcore/stores/user';
import { useAccountStore } from '@/@webcore/stores/account';
import { ECountry } from '@core/common/enums/ECountry';
import { EUserDocumentType } from '@core/common/enums/EUserDocumentType';
import { EUserStatus } from '@core/common/enums/EUserStatus';
import {
  EditUserParamsRequest,
  UpdateUserRequest,
} from '@core/schema/user/editUser/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { useStatesAndCities } from '@/composables/useStatesAndCities';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { getAdministrator, getUser } from '@/@webcore/localStorage/user';
import { EColor } from '@core/common/enums/EColor';

const userStore = useUsersStore();
const accountStore = useAccountStore();
const { items: countryCodes } = useCountryCodes();
const {
  states,
  cities,
  filteredStates,
  filteredCities,
  stateSearchQuery,
  citySearchQuery,
  loadStates,
  loadCities,
  clearCities,
  loadingStates,
  loadingCities,
} = useStatesAndCities();
const { t } = useI18n();

const isAdministrator = computed(() => getAdministrator());
const currentUser = computed(() => getUser());
const accountId = ref<string | null>(null);
const accountsOptions = ref<{ account_id: string; name: string }[]>([]);

const countrySearchQuery = ref('');
const isCountryMenuOpen = ref(false);

const filteredCountryCodes = computed(() => {
  if (!countrySearchQuery.value) {
    return countryCodes.value;
  }
  const query = countrySearchQuery.value.toLowerCase();
  return countryCodes.value.filter((country) =>
    country.title.toLowerCase().includes(query)
  );
});

watch(isCountryMenuOpen, (isOpen) => {
  if (!isOpen) {
    countrySearchQuery.value = '';
  }
});

const props = defineProps<{
  modelValue: boolean;
  userId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

function formatPhone(value: string | null | undefined): string {
  if (!value) return '';

  const numbers = value.replaceAll(/\D/g, '').slice(0, 11);

  if (numbers.length <= 2) {
    return numbers;
  }
  if (numbers.length <= 6) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  }
  if (numbers.length <= 10) {
    return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  }
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return true;
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

const itemsStatus = ref([
  { id: EUserStatus.active, text: t('active') },
  { id: EUserStatus.inactive, text: t('inactive') },
  { id: EUserStatus.blocked, text: t('blocked') },
]);

const itemsDocuments = ref([
  { value: EUserDocumentType.CPF, title: t('cpf') },
  { value: EUserDocumentType.CNPJ, title: t('cnpj') },
]);

const itemsCountry = ref([{ value: ECountry.Brasil, title: t('brazil') }]);

const isCPF = computed(
  () => user_document_type_id.value === EUserDocumentType.CPF
);
const isCNPJ = computed(
  () => user_document_type_id.value === EUserDocumentType.CNPJ
);

const docConfig = {
  cpf: {
    mask: '###.###.###-##',
    label: t('cpf'),
    placeholder: '000.000.000-00',
  },
  cnpj: {
    mask: '##.###.###/####-##',
    label: t('cnpj'),
    placeholder: '00.000.000/0000-00',
  },
};

const currentType = computed<'cpf' | 'cnpj' | null>(
  () => (isCPF.value && 'cpf') || (isCNPJ.value && 'cnpj') || null
);

const docMask = computed(() =>
  currentType.value ? docConfig[currentType.value].mask : ''
);
const docLabel = computed(() =>
  currentType.value ? docConfig[currentType.value].label : ''
);
const docPlaceholder = computed(() =>
  currentType.value ? docConfig[currentType.value].placeholder : ''
);

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');

const cpfRegex = /^\d{11}$/;
const cnpjRegex = /^\d{14}$/;

const docRules = computed(() => [
  (v: string | null) => {
    if (!isDocumentDecrypted.value) return true;

    const digits = onlyDigits(v ?? '');
    return (!!digits && digits.length > 0) || t('required');
  },
  (v: string | null) => {
    if (!isDocumentDecrypted.value) return true;

    const digits = onlyDigits(v ?? '');
    if (!digits) return true;

    if (isCPF.value) return cpfRegex.test(digits) || t('cpf_invalid');
    if (isCNPJ.value) return cnpjRegex.test(digits) || t('cnpj_invalid');
    return true;
  },
]);

const tab = ref('user_data');

const userId = toRef(props, 'userId');
const email = ref<string | null>(null);
const emailPartialOriginal = ref<string | null>(null);
const isEmailDecrypted = ref(false);
const isLoadingEmail = ref(false);
const password = ref<string | null>(null);
const confirmPassword = ref<string | null>(null);
const phone_ddi = ref<string | null>(null);
const phone = ref<string | null>(null);
const phonePartialOriginal = ref<string | null>(null);
const isPhoneDecrypted = ref(false);
const isLoadingPhone = ref(false);
const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const birth_date = ref<string | null>(null);
const user_document_type_id = ref<string | null>(null);
const document = ref<string | null>(null);
const documentPartialOriginal = ref<string | null>(null);
const documentDecryptedOriginal = ref<string | null>(null);
const isDocumentDecrypted = ref(false);
const isLoadingDocument = ref(false);
const country_id = ref<number | null>(null);
const zip_code = ref<string | null>(null);
const address1 = ref<string | null>(null);
const address1PartialOriginal = ref<string | null>(null);
const isAddress1Decrypted = ref(false);
const isLoadingAddress1 = ref(false);
const address2 = ref<string | null>(null);
const address2PartialOriginal = ref<string | null>(null);
const isAddress2Decrypted = ref(false);
const isLoadingAddress2 = ref(false);
const city = ref<string | null>(null);
const state = ref<string | null>(null);
const state_id = ref<string | null>(null);
const city_id = ref<string | null>(null);
const isStateMenuOpen = ref(false);
const isCityMenuOpen = ref(false);
const district = ref<string | null>(null);
const user_status_id = ref<string | null>(null);

const photo = ref<string | null>(null);
const photoFile = ref<File | null>(null);
const photoPreview = ref<string | null>(null);
const photoRemoved = ref<boolean>(false);
const isCropModalOpen = ref(false);
const cropImageRef = ref<HTMLImageElement | null>(null);
const cropCanvasRef = ref<HTMLCanvasElement | null>(null);
const cropPreviewSize = 400;

const cropDialog = ref({
  imageSrc: '',
  croppedImage: '',
});

const cropArea = ref({
  x: 0,
  y: 0,
  width: 200,
  height: 200,
  aspectRatio: 1,
  isDragging: false,
  isResizing: false,
  startX: 0,
  startY: 0,
  initialWidth: 0,
  initialHeight: 0,
  initialX: 0,
  initialY: 0,
  resizeHandle: null as 'nw' | 'ne' | 'sw' | 'se' | null,
});

const MAX_FILE_SIZE_BYTES = 16 * 1024 * 1024;

const initialValues = ref<{
  email: string | null;
  phone_ddi: string | null;
  phone: string | null;
  name: string | null;
  last_name: string | null;
  birth_date: string | null;
  user_document_type_id: string | null;
  document: string | null;
  country_id: number | null;
  zip_code: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  district: string | null;
  user_status_id: string | null;
  account_id: string | null;
}>({
  email: null,
  phone_ddi: null,
  phone: null,
  name: null,
  last_name: null,
  birth_date: null,
  user_document_type_id: null,
  document: null,
  country_id: null,
  zip_code: null,
  address1: null,
  address2: null,
  city: null,
  state: null,
  district: null,
  user_status_id: null,
  account_id: null,
});

const refFormEditUser = ref<VForm>();

const isPasswordVisible = ref(false);
const isConfirmVisible = ref(false);

const refFormStep1 = ref<VForm>();
const refFormStep2 = ref<VForm>();

const zipInputRef = ref<HTMLInputElement | null>(null);

const validateStep1 = async (): Promise<boolean> => {
  const validation = await refFormStep1.value?.validate();
  return validation?.valid ?? false;
};

const validateStep2 = async (): Promise<boolean> => {
  const validation = await refFormStep2.value?.validate();
  return validation?.valid ?? false;
};

const validateStep3 = async (): Promise<boolean> => {
  const validation = await refFormEditUser.value?.validate();
  return validation?.valid ?? false;
};

const navigateToNextTab = (currentTab: string): string => {
  if (currentTab === 'user_data') return 'additional_info';
  if (currentTab === 'additional_info') return 'address';
  return currentTab;
};

const navigateToPrevTab = (currentTab: string): string => {
  if (currentTab === 'additional_info') return 'user_data';
  if (currentTab === 'address') return 'additional_info';
  return currentTab;
};

const isAdvancing = (fromTab: string, toTab: string): boolean => {
  const tabOrder = ['user_data', 'additional_info', 'address'];
  const fromIndex = tabOrder.indexOf(fromTab);
  const toIndex = tabOrder.indexOf(toTab);
  return toIndex > fromIndex;
};

const onTabChange = async (newTab: string | unknown) => {
  if (typeof newTab !== 'string') {
    return;
  }

  const currentTab = tab.value;

  if (currentTab === newTab) {
    return;
  }

  const advancing = isAdvancing(currentTab, newTab);

  if (!advancing) {
    tab.value = newTab;
    return;
  }

  if (currentTab === 'user_data') {
    const isValid = await validateStep1();
    if (!isValid) return;
    tab.value = newTab;
    return;
  }

  if (currentTab === 'additional_info') {
    const isValid = await validateStep2();
    if (!isValid) return;
    tab.value = newTab;
    return;
  }

  if (currentTab === 'address') {
    const isValid = await validateStep3();
    if (!isValid) return;
    tab.value = newTab;
    return;
  }

  tab.value = newTab;
};

const goNext = async () => {
  if (tab.value === 'user_data') {
    const isValid = await validateStep1();
    if (!isValid) return;
    tab.value = navigateToNextTab(tab.value);
    return;
  }
  if (tab.value === 'additional_info') {
    const isValid = await validateStep2();
    if (!isValid) return;
    tab.value = navigateToNextTab(tab.value);
  }
};

const goPrev = () => {
  tab.value = navigateToPrevTab(tab.value);
};

const rules = {
  passwordMinIfFilled: (v: string | null) =>
    !v || v.length >= 8 || t('minimum_eight_characters'),

  confirmRequiredIfPassword: (v: string | null) =>
    !password.value || !!v || t('confirm_password'),

  confirmMatches: (v: string | null) =>
    !password.value || v === password.value || t('the_password_do_not_match'),
};

const getPhoneFormattedValue = (): string => {
  if (isPhoneDecrypted.value && phone.value) {
    return formatPhone(phone.value);
  }
  if (phone.value && !isPhoneDecrypted.value) {
    return formatPhone(phone.value);
  }
  return phonePartialOriginal.value ?? '';
};

const setPhoneFormattedValue = (value: string) => {
  if (isPhoneDecrypted.value) {
    phone.value = value.replaceAll(/\D/g, '');
    return;
  }
  const numbers = value.replaceAll(/\D/g, '');
  phone.value = numbers;
  phonePartialOriginal.value = value;
};

const phoneFormatted = computed({
  get: getPhoneFormattedValue,
  set: setPhoneFormattedValue,
});

const getEmailFormattedValue = (): string => {
  if (isEmailDecrypted.value) {
    return email.value ?? '';
  }
  return emailPartialOriginal.value ?? '';
};

const setEmailFormattedValue = (value: string) => {
  if (isEmailDecrypted.value) {
    email.value = value;
    return;
  }
  emailPartialOriginal.value = value;
  email.value = value;
};

const emailFormatted = computed({
  get: getEmailFormattedValue,
  set: setEmailFormattedValue,
});

const getAddress1FormattedValue = (): string => {
  if (isAddress1Decrypted.value) {
    return address1.value ?? '';
  }
  return address1PartialOriginal.value ?? '';
};

const setAddress1FormattedValue = (value: string) => {
  if (isAddress1Decrypted.value) {
    address1.value = value;
    return;
  }
  address1PartialOriginal.value = value;
  address1.value = value;
};

const address1Formatted = computed({
  get: getAddress1FormattedValue,
  set: setAddress1FormattedValue,
});

const getAddress2FormattedValue = (): string => {
  if (isAddress2Decrypted.value) {
    return address2.value ?? '';
  }
  return address2PartialOriginal.value ?? '';
};

const setAddress2FormattedValue = (value: string) => {
  if (isAddress2Decrypted.value) {
    address2.value = value;
    return;
  }
  address2PartialOriginal.value = value;
  address2.value = value;
};

const address2Formatted = computed({
  get: getAddress2FormattedValue,
  set: setAddress2FormattedValue,
});

const startEditPhone = async () => {
  if (!userId.value) return;

  if (!isPhoneDecrypted.value && phonePartialOriginal.value) {
    isLoadingPhone.value = true;
    const decryptedPhone = await userStore.getUserPhoneDecrypted(userId.value);
    isLoadingPhone.value = false;

    if (decryptedPhone) {
      phone.value = decryptedPhone.replaceAll(/\D/g, '');
      initialValues.value.phone = decryptedPhone.replaceAll(/\D/g, '');
      isPhoneDecrypted.value = true;
    }
  }
};

const resetPhoneToPartial = () => {
  isPhoneDecrypted.value = false;
  if (phonePartialOriginal.value?.includes('*')) {
    phone.value = null;
    return;
  }
  if (phonePartialOriginal.value) {
    phone.value = phonePartialOriginal.value.replaceAll(/\D/g, '');
    return;
  }
  phone.value = null;
};

const decryptPhone = async () => {
  isLoadingPhone.value = true;
  const decryptedPhone = await userStore.getUserPhoneDecrypted(userId.value!);
  isLoadingPhone.value = false;

  if (decryptedPhone) {
    phone.value = decryptedPhone.replaceAll(/\D/g, '');
    initialValues.value.phone = decryptedPhone.replaceAll(/\D/g, '');
    isPhoneDecrypted.value = true;
  }
};

const togglePhoneVisibility = async () => {
  if (!userId.value) return;

  if (isPhoneDecrypted.value) {
    resetPhoneToPartial();
    return;
  }

  await decryptPhone();
};

const startEditEmail = async () => {
  if (!userId.value) return;

  if (!isEmailDecrypted.value && emailPartialOriginal.value) {
    isLoadingEmail.value = true;
    const decryptedEmail = await userStore.getUserEmailDecrypted(userId.value);
    isLoadingEmail.value = false;

    if (decryptedEmail) {
      email.value = decryptedEmail;
      initialValues.value.email = decryptedEmail;
      isEmailDecrypted.value = true;
    }
  }
};

const resetEmailToPartial = () => {
  isEmailDecrypted.value = false;
  email.value = emailPartialOriginal.value;
};

const decryptEmail = async () => {
  isLoadingEmail.value = true;
  const decryptedEmail = await userStore.getUserEmailDecrypted(userId.value!);
  isLoadingEmail.value = false;

  if (decryptedEmail) {
    email.value = decryptedEmail;
    initialValues.value.email = decryptedEmail;
    isEmailDecrypted.value = true;
  }
};

const toggleEmailVisibility = async () => {
  if (!userId.value) return;

  if (isEmailDecrypted.value) {
    resetEmailToPartial();
    return;
  }

  await decryptEmail();
};

const startEditDocument = async () => {
  if (!userId.value) return;

  if (!isDocumentDecrypted.value && documentPartialOriginal.value) {
    isLoadingDocument.value = true;
    const decryptedDocument = await userStore.getUserDocumentDecrypted(
      userId.value
    );
    isLoadingDocument.value = false;

    if (decryptedDocument) {
      const digits = decryptedDocument.replaceAll(/\D/g, '');
      isDocumentDecrypted.value = true;
      await nextTick();
      document.value = digits;
      documentDecryptedOriginal.value = digits;
    }
  }
};

const handleDocumentBlur = () => {
  if (!isDocumentDecrypted.value) return;

  if (document.value) {
    const digits = String(document.value).replaceAll(/\D/g, '');
    document.value = digits;
  }

  const currentDigits = document.value?.replaceAll(/\D/g, '') ?? '';
  const originalDigits =
    documentDecryptedOriginal.value?.replaceAll(/\D/g, '') ?? '';

  if (currentDigits === originalDigits) {
    isDocumentDecrypted.value = false;
    document.value = null;
  }
};

const toggleDocumentVisibility = async () => {
  if (!userId.value) return;

  if (isDocumentDecrypted.value) {
    isDocumentDecrypted.value = false;
    document.value = null;
    documentDecryptedOriginal.value = null;
    return;
  }

  isLoadingDocument.value = true;
  const decryptedDocument = await userStore.getUserDocumentDecrypted(
    userId.value
  );
  isLoadingDocument.value = false;

  if (decryptedDocument) {
    const digits = decryptedDocument.replaceAll(/\D/g, '');
    isDocumentDecrypted.value = true;
    await nextTick();
    document.value = digits;
    documentDecryptedOriginal.value = digits;
  }
};

const startEditAddress1 = async () => {
  if (!userId.value) return;

  if (!isAddress1Decrypted.value && address1PartialOriginal.value) {
    isLoadingAddress1.value = true;
    const decryptedAddress1 = await userStore.getUserAddress1Decrypted(
      userId.value
    );
    isLoadingAddress1.value = false;

    if (decryptedAddress1) {
      address1.value = decryptedAddress1;
      initialValues.value.address1 = decryptedAddress1;
      isAddress1Decrypted.value = true;
    }
  }
};

const resetAddress1ToPartial = () => {
  isAddress1Decrypted.value = false;
  if (address1PartialOriginal.value?.includes('*')) {
    address1.value = null;
    return;
  }
  if (address1PartialOriginal.value) {
    address1.value = address1PartialOriginal.value;
    return;
  }
  address1.value = null;
};

const decryptAddress1 = async () => {
  isLoadingAddress1.value = true;
  const decryptedAddress1 = await userStore.getUserAddress1Decrypted(
    userId.value!
  );
  isLoadingAddress1.value = false;

  if (decryptedAddress1) {
    address1.value = decryptedAddress1;
    initialValues.value.address1 = decryptedAddress1;
    isAddress1Decrypted.value = true;
  }
};

const toggleAddress1Visibility = async () => {
  if (!userId.value) return;

  if (isAddress1Decrypted.value) {
    resetAddress1ToPartial();
    return;
  }

  await decryptAddress1();
};

const startEditAddress2 = async () => {
  if (!userId.value) return;

  if (!isAddress2Decrypted.value && address2PartialOriginal.value) {
    isLoadingAddress2.value = true;
    const decryptedAddress2 = await userStore.getUserAddress2Decrypted(
      userId.value
    );
    isLoadingAddress2.value = false;

    if (decryptedAddress2) {
      address2.value = decryptedAddress2;
      initialValues.value.address2 = decryptedAddress2;
      isAddress2Decrypted.value = true;
    }
  }
};

const resetAddress2ToPartial = () => {
  isAddress2Decrypted.value = false;
  if (address2PartialOriginal.value?.includes('*')) {
    address2.value = null;
    return;
  }
  if (address2PartialOriginal.value) {
    address2.value = address2PartialOriginal.value;
    return;
  }
  address2.value = null;
};

const decryptAddress2 = async () => {
  isLoadingAddress2.value = true;
  const decryptedAddress2 = await userStore.getUserAddress2Decrypted(
    userId.value!
  );
  isLoadingAddress2.value = false;

  if (decryptedAddress2) {
    address2.value = decryptedAddress2;
    initialValues.value.address2 = decryptedAddress2;
    isAddress2Decrypted.value = true;
  }
};

const toggleAddress2Visibility = async () => {
  if (!userId.value) return;

  if (isAddress2Decrypted.value) {
    resetAddress2ToPartial();
    return;
  }

  await decryptAddress2();
};

const determineEmailToSave = (): string | null | undefined => {
  const emailValue = email.value?.trim() || '';
  const emailOriginalTrimmed = initialValues.value.email?.trim() || '';

  if (!emailValue) {
    return undefined;
  }

  if (isEmailDecrypted.value) {
    if (emailValue !== emailOriginalTrimmed) {
      return emailValue;
    }
    return undefined;
  }

  if (!emailValue.includes('*') && emailValue !== emailOriginalTrimmed) {
    return emailValue;
  }

  return undefined;
};

const determinePhoneToSave = (): string | null | undefined => {
  const phoneValue = phone.value ? phone.value.replaceAll(/\D/g, '') : '';
  const phoneOriginalNumbers = initialValues.value.phone
    ? initialValues.value.phone.replaceAll(/\D/g, '')
    : '';

  if (!phoneValue) {
    return undefined;
  }

  if (isPhoneDecrypted.value) {
    if (phoneValue !== phoneOriginalNumbers) {
      return phoneValue;
    }
    return undefined;
  }

  if (
    !phonePartialOriginal.value?.includes('*') &&
    phoneValue !== phoneOriginalNumbers
  ) {
    return phoneValue;
  }

  return undefined;
};

const determineDocumentToSave = (): string | null | undefined => {
  if (!isCPF.value && !isCNPJ.value) return undefined;

  if (!isDocumentDecrypted.value) return undefined;

  const digits = document.value?.replaceAll(/\D/g, '') ?? '';
  const originalDigits =
    initialValues.value.document?.replaceAll(/\D/g, '') ?? '';

  if (digits === originalDigits) return undefined;

  if (!digits) return '';

  return digits;
};

const determineAddress1ToSave = (): string | null | undefined => {
  const address1Value = address1.value?.trim() || '';
  const address1OriginalTrimmed = initialValues.value.address1?.trim() || '';

  if (!address1Value) {
    return undefined;
  }

  if (isAddress1Decrypted.value) {
    if (address1Value !== address1OriginalTrimmed) {
      return address1Value;
    }
    return undefined;
  }

  if (
    !address1Value.includes('*') &&
    address1Value !== address1OriginalTrimmed
  ) {
    return address1Value;
  }

  return undefined;
};

const determineAddress2ToSave = (): string | null | undefined => {
  const address2Value = address2.value?.trim() || '';
  const address2OriginalTrimmed = initialValues.value.address2?.trim() || '';

  if (!address2Value) {
    return undefined;
  }

  if (isAddress2Decrypted.value) {
    if (address2Value !== address2OriginalTrimmed) {
      return address2Value;
    }
    return undefined;
  }

  if (
    !address2Value.includes('*') &&
    address2Value !== address2OriginalTrimmed
  ) {
    return address2Value;
  }

  return undefined;
};

const buildUserInfo = (): {
  phone_ddi?: string | null;
  phone?: string | null;
  name?: string | null;
  last_name?: string | null;
  birth_date?: string | null;
} | null => {
  const userInfo: {
    phone_ddi?: string | null;
    phone?: string | null;
    name?: string | null;
    last_name?: string | null;
    birth_date?: string | null;
  } = {};

  if (phone_ddi.value !== initialValues.value.phone_ddi) {
    userInfo.phone_ddi = phone_ddi.value;
  }

  const phoneToSave = determinePhoneToSave();
  if (phoneToSave !== undefined) {
    userInfo.phone = phoneToSave ?? null;
  }

  if (name.value !== initialValues.value.name) {
    userInfo.name = name.value;
  }

  if (last_name.value !== initialValues.value.last_name) {
    userInfo.last_name = last_name.value;
  }

  if (birth_date.value !== initialValues.value.birth_date) {
    userInfo.birth_date = birth_date.value;
  }

  if (Object.keys(userInfo).length === 0) {
    return null;
  }

  return userInfo;
};

const buildUserDocument = (): {
  user_document_type_id?: string | null;
  document?: string;
} | null => {
  const userDocument: {
    user_document_type_id?: string | null;
    document?: string;
  } = {};

  if (
    user_document_type_id.value !== initialValues.value.user_document_type_id
  ) {
    userDocument.user_document_type_id = user_document_type_id.value;
  }

  const documentToSave = determineDocumentToSave();
  if (documentToSave !== undefined) {
    userDocument.document = documentToSave ?? '';
  }

  if (Object.keys(userDocument).length === 0) {
    return null;
  }

  return userDocument;
};

const createFileInput = (): HTMLInputElement => {
  const input = window.document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  return input;
};

const openFileSelector = () => {
  const input = createFileInput();
  input.onchange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
  };
  input.click();
};

const validateFileSize = (file: File): boolean => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    userStore.showSnackbar(
      t('profile_status_file_size_exceeded', { max: '16 MB' }),
      EColor.error
    );
    return false;
  }
  return true;
};

const handleImageSelect = (file: File) => {
  if (!validateFileSize(file)) {
    return;
  }

  const reader = new FileReader();
  reader.onload = (e: ProgressEvent<FileReader>) => {
    const result = e.target?.result as string;
    if (result) {
      cropDialog.value.imageSrc = result;
      isCropModalOpen.value = true;
      photoFile.value = file;
      nextTick(() => {
        initializeCrop();
      });
    }
  };
  reader.readAsDataURL(file);
};

const initializeCrop = () => {
  if (!cropImageRef.value) return;

  const img = cropImageRef.value;
  const containerWidth = 400;
  const containerHeight = 400;

  if (img.complete) {
    setupCropArea(img, containerWidth, containerHeight);
    return;
  }

  img.onload = () => {
    setupCropArea(img, containerWidth, containerHeight);
  };
};

const calculateImageDimensions = (
  img: HTMLImageElement,
  containerWidth: number,
  containerHeight: number
): { displayWidth: number; displayHeight: number } => {
  const imgAspect = img.naturalWidth / img.naturalHeight;
  const containerAspect = containerWidth / containerHeight;

  let displayWidth = containerWidth;
  let displayHeight = containerHeight;

  if (imgAspect > containerAspect) {
    displayHeight = containerWidth / imgAspect;
  }

  if (imgAspect <= containerAspect) {
    displayWidth = containerHeight * imgAspect;
  }

  return { displayWidth, displayHeight };
};

const setupCropArea = (
  img: HTMLImageElement,
  containerWidth: number,
  containerHeight: number
) => {
  const { displayWidth, displayHeight } = calculateImageDimensions(
    img,
    containerWidth,
    containerHeight
  );

  img.style.width = `${displayWidth}px`;
  img.style.height = `${displayHeight}px`;

  cropArea.value.aspectRatio = 1;

  const maxCropSize = Math.min(displayWidth, displayHeight, cropPreviewSize);
  const cropSize = maxCropSize;

  cropArea.value.width = cropSize;
  cropArea.value.height = cropSize;

  const imgLeft = (containerWidth - displayWidth) / 2;
  const imgTop = (containerHeight - displayHeight) / 2;

  cropArea.value.x = imgLeft + Math.max(0, (displayWidth - cropSize) / 2);
  cropArea.value.y = imgTop + Math.max(0, (displayHeight - cropSize) / 2);
};

type CropResizeHandle = 'nw' | 'ne' | 'sw' | 'se';

const addCropEventListeners = () => {
  window.document.addEventListener('mousemove', onCropDrag);
  window.document.addEventListener('touchmove', onCropDrag);
  window.document.addEventListener('mouseup', endCropDrag);
  window.document.addEventListener('touchend', endCropDrag);
};

const startCropDrag = (e: MouseEvent | TouchEvent) => {
  e.preventDefault();
  e.stopPropagation();
  cropArea.value.isDragging = true;

  const { x: clientX, y: clientY } = getEventCoordinates(e);
  const container = cropImageRef.value?.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  cropArea.value.startX = clientX - rect.left - cropArea.value.x;
  cropArea.value.startY = clientY - rect.top - cropArea.value.y;

  addCropEventListeners();
};

const addCropResizeEventListeners = () => {
  window.document.addEventListener('mousemove', onCropResize);
  window.document.addEventListener('touchmove', onCropResize);
  window.document.addEventListener('mouseup', endCropResize);
  window.document.addEventListener('touchend', endCropResize);
};

const startCropResize = (
  handle: CropResizeHandle,
  e: MouseEvent | TouchEvent
) => {
  e.preventDefault();
  e.stopPropagation();
  cropArea.value.isResizing = true;
  cropArea.value.resizeHandle = handle;

  cropArea.value.initialWidth = cropArea.value.width;
  cropArea.value.initialHeight = cropArea.value.height;
  cropArea.value.initialX = cropArea.value.x;
  cropArea.value.initialY = cropArea.value.y;

  const { x: clientX, y: clientY } = getEventCoordinates(e);
  const container = cropImageRef.value?.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  cropArea.value.startX = clientX - rect.left;
  cropArea.value.startY = clientY - rect.top;

  addCropResizeEventListeners();
};

const calculateCropDragPosition = (
  clientX: number,
  clientY: number,
  container: HTMLElement
): { x: number; y: number } => {
  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left - cropArea.value.startX;
  const y = clientY - rect.top - cropArea.value.startY;

  const imgWidth = cropImageRef.value!.offsetWidth;
  const imgHeight = cropImageRef.value!.offsetHeight;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  const imgLeft = (containerWidth - imgWidth) / 2;
  const imgTop = (containerHeight - imgHeight) / 2;

  const minX = imgLeft;
  const minY = imgTop;
  const maxX = imgLeft + imgWidth - cropArea.value.width;
  const maxY = imgTop + imgHeight - cropArea.value.height;

  return {
    x: Math.max(minX, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY)),
  };
};

const onCropDrag = (e: MouseEvent | TouchEvent) => {
  if (!cropArea.value.isDragging || !cropImageRef.value) return;

  e.preventDefault();
  const { x: clientX, y: clientY } = getEventCoordinates(e);
  const container = cropImageRef.value.parentElement;
  if (!container) return;

  const position = calculateCropDragPosition(clientX, clientY, container);
  cropArea.value.x = position.x;
  cropArea.value.y = position.y;
};

const getEventCoordinates = (
  e: MouseEvent | TouchEvent
): { x: number; y: number } => {
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  return { x: clientX, y: clientY };
};

const getFixedPoint = (
  handle: CropResizeHandle,
  x: number,
  y: number,
  width: number,
  height: number
): { x: number; y: number } => {
  switch (handle) {
    case 'nw':
      return { x: x + width, y: y + height };
    case 'ne':
      return { x, y: y + height };
    case 'sw':
      return { x: x + width, y };
    case 'se':
      return { x, y };
    default:
      return { x, y };
  }
};

const calculateInitialPosition = (
  handle: CropResizeHandle,
  fixedX: number,
  fixedY: number,
  size: number
): { x: number; y: number } => {
  switch (handle) {
    case 'nw':
      return { x: fixedX - size, y: fixedY - size };
    case 'ne':
      return { x: fixedX, y: fixedY - size };
    case 'sw':
      return { x: fixedX - size, y: fixedY };
    case 'se':
      return { x: fixedX, y: fixedY };
    default:
      return { x: fixedX, y: fixedY };
  }
};

const applyMinSizeConstraint = (
  handle: CropResizeHandle,
  fixedPoint: { x: number; y: number },
  minSize: number,
  dimensions: { width: number; height: number; x: number; y: number }
): { width: number; height: number; x: number; y: number } => {
  if (dimensions.width < minSize) {
    dimensions.width = minSize;
  }
  if (dimensions.height < minSize) {
    dimensions.height = minSize;
  }

  const { x, y } = calculateInitialPosition(
    handle,
    fixedPoint.x,
    fixedPoint.y,
    dimensions.width
  );
  dimensions.x = x;
  dimensions.y = y;

  return dimensions;
};

const applyMaxSizeConstraint = (
  handle: CropResizeHandle,
  fixedPoint: { x: number; y: number },
  constraints: { maxWidth: number; maxHeight: number },
  dimensions: { width: number; height: number; x: number; y: number }
): { width: number; height: number; x: number; y: number } => {
  if (dimensions.width > constraints.maxWidth) {
    dimensions.width = constraints.maxWidth;
  }
  if (dimensions.height > constraints.maxHeight) {
    dimensions.height = constraints.maxHeight;
  }

  const { x, y } = calculateInitialPosition(
    handle,
    fixedPoint.x,
    fixedPoint.y,
    dimensions.width
  );
  dimensions.x = x;
  dimensions.y = y;

  return dimensions;
};

const applyBoundaryConstraints = (
  maxWidth: number,
  maxHeight: number,
  width: number,
  height: number,
  x: number,
  y: number
): { x: number; y: number } => {
  let newX = x;
  let newY = y;

  if (newX < 0) {
    newX = 0;
  }
  if (newY < 0) {
    newY = 0;
  }
  if (newX + width > maxWidth) {
    newX = maxWidth - width;
  }
  if (newY + height > maxHeight) {
    newY = maxHeight - height;
  }

  return { x: newX, y: newY };
};

const calculateCropResizeDimensions = (
  e: MouseEvent | TouchEvent,
  handle: CropResizeHandle
): { width: number; height: number; x: number; y: number } | null => {
  const container = cropImageRef.value?.parentElement;
  if (!container) return null;

  const { x: clientX, y: clientY } = getEventCoordinates(e);
  const rect = container.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  const { x: fixedX, y: fixedY } = getFixedPoint(
    handle,
    cropArea.value.initialX,
    cropArea.value.initialY,
    cropArea.value.initialWidth,
    cropArea.value.initialHeight
  );

  const deltaX = mouseX - fixedX;
  const deltaY = mouseY - fixedY;
  const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));

  const { x: initialX, y: initialY } = calculateInitialPosition(
    handle,
    fixedX,
    fixedY,
    size
  );

  const imgWidth = cropImageRef.value!.offsetWidth;
  const imgHeight = cropImageRef.value!.offsetHeight;
  const resizeContainer = cropImageRef.value!.parentElement;
  if (!resizeContainer) return null;

  const resizeContainerWidth = resizeContainer.clientWidth;
  const resizeContainerHeight = resizeContainer.clientHeight;
  const imgLeft = (resizeContainerWidth - imgWidth) / 2;
  const imgTop = (resizeContainerHeight - imgHeight) / 2;

  const maxWidth = imgLeft + imgWidth;
  const maxHeight = imgTop + imgHeight;
  const minSize = 50;

  const fixedPoint = { x: fixedX, y: fixedY };
  let dimensions = applyMinSizeConstraint(handle, fixedPoint, minSize, {
    width: size,
    height: size,
    x: initialX,
    y: initialY,
  });

  dimensions = applyMaxSizeConstraint(
    handle,
    fixedPoint,
    { maxWidth, maxHeight },
    dimensions
  );

  const finalImgWidth = cropImageRef.value!.offsetWidth;
  const finalImgHeight = cropImageRef.value!.offsetHeight;
  const finalContainer = cropImageRef.value!.parentElement;
  if (!finalContainer) return null;

  const finalContainerWidth = finalContainer.clientWidth;
  const finalContainerHeight = finalContainer.clientHeight;
  const finalImgLeft = (finalContainerWidth - finalImgWidth) / 2;
  const finalImgTop = (finalContainerHeight - finalImgHeight) / 2;

  const minX = finalImgLeft;
  const minY = finalImgTop;
  const maxX = finalImgLeft + finalImgWidth;
  const maxY = finalImgTop + finalImgHeight;

  const finalPosition = applyBoundaryConstraints(
    maxX,
    maxY,
    dimensions.width,
    dimensions.height,
    dimensions.x,
    dimensions.y
  );

  finalPosition.x = Math.max(
    minX,
    Math.min(finalPosition.x, maxX - dimensions.width)
  );
  finalPosition.y = Math.max(
    minY,
    Math.min(finalPosition.y, maxY - dimensions.height)
  );

  return {
    width: dimensions.width,
    height: dimensions.height,
    x: finalPosition.x,
    y: finalPosition.y,
  };
};

const onCropResize = (e: MouseEvent | TouchEvent) => {
  if (
    !cropArea.value.isResizing ||
    !cropImageRef.value ||
    !cropArea.value.resizeHandle
  ) {
    return;
  }

  e.preventDefault();

  const dimensions = calculateCropResizeDimensions(
    e,
    cropArea.value.resizeHandle
  );
  if (!dimensions) return;

  cropArea.value.width = dimensions.width;
  cropArea.value.height = dimensions.height;
  cropArea.value.x = dimensions.x;
  cropArea.value.y = dimensions.y;
};

const removeCropEventListeners = () => {
  window.document.removeEventListener('mousemove', onCropDrag);
  window.document.removeEventListener('touchmove', onCropDrag);
  window.document.removeEventListener('mouseup', endCropDrag);
  window.document.removeEventListener('touchend', endCropDrag);
};

const endCropDrag = () => {
  cropArea.value.isDragging = false;
  removeCropEventListeners();
};

const removeCropResizeEventListeners = () => {
  window.document.removeEventListener('mousemove', onCropResize);
  window.document.removeEventListener('touchmove', onCropResize);
  window.document.removeEventListener('mouseup', endCropResize);
  window.document.removeEventListener('touchend', endCropResize);
};

const endCropResize = () => {
  cropArea.value.isResizing = false;
  cropArea.value.resizeHandle = null;
  removeCropResizeEventListeners();
};

const calculateCropCoordinates = (
  img: HTMLImageElement,
  container: HTMLElement
): {
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
} => {
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const imgLeft = (containerWidth - img.offsetWidth) / 2;
  const imgTop = (containerHeight - img.offsetHeight) / 2;

  const relativeX = cropArea.value.x - imgLeft;
  const relativeY = cropArea.value.y - imgTop;

  const scaleX = img.naturalWidth / img.offsetWidth;
  const scaleY = img.naturalHeight / img.offsetHeight;

  return {
    sourceX: relativeX * scaleX,
    sourceY: relativeY * scaleY,
    sourceWidth: cropArea.value.width * scaleX,
    sourceHeight: cropArea.value.height * scaleY,
  };
};

const drawCroppedImage = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  canvas: HTMLCanvasElement,
  coordinates: {
    sourceX: number;
    sourceY: number;
    sourceWidth: number;
    sourceHeight: number;
  }
) => {
  canvas.width = cropPreviewSize;
  canvas.height = cropPreviewSize;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    img,
    coordinates.sourceX,
    coordinates.sourceY,
    coordinates.sourceWidth,
    coordinates.sourceHeight,
    0,
    0,
    cropPreviewSize,
    cropPreviewSize
  );
};

const createCroppedFile = (blob: Blob): File => {
  return new File([blob], 'user-photo.jpg', {
    type: 'image/jpeg',
  });
};

const handleCropSuccess = (canvas: HTMLCanvasElement) => {
  const croppedFile = createCroppedFile(
    new Blob([canvas.toDataURL('image/jpeg')], { type: 'image/jpeg' })
  );
  photoFile.value = croppedFile;
  photoPreview.value = canvas.toDataURL('image/jpeg');
  cropDialog.value.croppedImage = canvas.toDataURL('image/jpeg');
  isCropModalOpen.value = false;
};

const cropImage = () => {
  if (!cropImageRef.value || !cropCanvasRef.value) return;

  const img = cropImageRef.value;
  const canvas = cropCanvasRef.value;
  const ctx = canvas.getContext('2d');

  if (!ctx || !img.complete) {
    userStore.showSnackbar(t('wait_image_load'), EColor.warning);
    return;
  }

  const container = img.parentElement;
  if (!container) return;

  const coordinates = calculateCropCoordinates(img, container);
  drawCroppedImage(ctx, img, canvas, coordinates);

  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const croppedFile = createCroppedFile(blob);
      photoFile.value = croppedFile;
      photoPreview.value = canvas.toDataURL('image/jpeg');
      cropDialog.value.croppedImage = canvas.toDataURL('image/jpeg');
      isCropModalOpen.value = false;
    },
    'image/jpeg',
    0.9
  );
};

const cancelCrop = () => {
  isCropModalOpen.value = false;
  cropDialog.value.imageSrc = '';
  cropDialog.value.croppedImage = '';
  photoFile.value = null;
};

const removePhoto = () => {
  photo.value = null;
  photoFile.value = null;
  photoPreview.value = null;
  photoRemoved.value = true;
  cropDialog.value.imageSrc = '';
  cropDialog.value.croppedImage = '';
};

const determinePhotoUrl = (): string | null | undefined => {
  if (photoRemoved.value) {
    return null;
  }

  if (!photoFile.value) {
    if (photo.value && !photo.value.startsWith('data:')) {
      return photo.value;
    }
    if (photoPreview.value && !photoPreview.value.startsWith('data:')) {
      return photoPreview.value;
    }
    return undefined;
  }

  if (photoPreview.value && !photoPreview.value.startsWith('data:')) {
    return photoPreview.value;
  }

  return undefined;
};

const hasUpdatePayload = (body: UpdateUserRequest): boolean => {
  return (
    Object.keys(body).length > 0 || !!photoFile.value || photoRemoved.value
  );
};

const hasChanges = computed(() => {
  const body = buildUpdateUserBody();
  return hasUpdatePayload(body);
});

const updateUser = async () => {
  if (!userId.value) {
    return;
  }

  const payload: EditUserParamsRequest = {
    user_id: userId.value,
  };

  const body = buildUpdateUserBody();

  if (!hasUpdatePayload(body)) {
    return;
  }

  const photoUrl = determinePhotoUrl();
  const result = await userStore.updateUser(
    payload,
    body,
    photoUrl ? null : photoFile.value
  );

  if (result) {
    isVisible.value = false;
    await userStore.listUsers();
  }
};

const buildUpdateUserBody = (): UpdateUserRequest => {
  const body: UpdateUserRequest = {};

  const emailToSave = determineEmailToSave();
  if (emailToSave !== undefined) {
    body.email = { value: emailToSave };
  }

  const passwordValue = password.value;
  if (passwordValue) {
    body.password = { value: passwordValue };
  }

  const userStatusIdValue =
    user_status_id.value !== initialValues.value.user_status_id
      ? user_status_id.value
      : undefined;
  if (userStatusIdValue !== undefined) {
    body.user_status_id = { value: userStatusIdValue };
  }

  const accountIdValue =
    isAdministrator.value && accountId.value !== initialValues.value.account_id
      ? accountId.value
      : undefined;
  if (accountIdValue !== undefined) {
    body.account_id = { value: accountIdValue };
  }

  const phoneDdiValue =
    phone_ddi.value !== initialValues.value.phone_ddi
      ? phone_ddi.value
      : undefined;
  if (phoneDdiValue !== undefined) {
    body.phone_ddi = { value: phoneDdiValue };
  }

  const phoneToSave = determinePhoneToSave();
  if (phoneToSave !== undefined) {
    body.phone = { value: phoneToSave };
  }

  const nameValue =
    name.value !== initialValues.value.name ? name.value : undefined;
  if (nameValue !== undefined) {
    body.name = { value: nameValue };
  }

  const lastNameValue =
    last_name.value !== initialValues.value.last_name
      ? last_name.value
      : undefined;
  if (lastNameValue !== undefined) {
    body.last_name = { value: lastNameValue };
  }

  const birthDateValue =
    birth_date.value !== initialValues.value.birth_date
      ? birth_date.value
      : undefined;
  if (birthDateValue !== undefined) {
    body.birth_date = { value: birthDateValue };
  }

  const documentTypeIdValue =
    user_document_type_id.value !== initialValues.value.user_document_type_id
      ? user_document_type_id.value
      : undefined;
  if (documentTypeIdValue !== undefined) {
    body.document_type_id = { value: documentTypeIdValue };
  }

  const documentToSave = determineDocumentToSave();
  if (documentToSave !== undefined) {
    body.document = { value: documentToSave };
  }

  const countryIdValue =
    country_id.value !== initialValues.value.country_id
      ? country_id.value
      : undefined;
  if (countryIdValue !== undefined) {
    body.country_id = { value: countryIdValue };
  }

  const zipCodeValue =
    zip_code.value !== initialValues.value.zip_code
      ? zip_code.value
      : undefined;
  if (zipCodeValue !== undefined) {
    body.zip_code = { value: zipCodeValue };
  }

  const address1ToSave = determineAddress1ToSave();
  if (address1ToSave !== undefined) {
    body.address1 = { value: address1ToSave };
  }

  const address2ToSave = determineAddress2ToSave();
  if (address2ToSave !== undefined) {
    body.address2 = { value: address2ToSave };
  }

  const selectedState = states.value.find(
    (s) => s.id_zipcode_state === state_id.value
  );
  const selectedCity = cities.value.find(
    (c) => c.id_zipcode_city === city_id.value
  );

  const cityFiscalCodeValue =
    city_id.value !== null && selectedCity?.fiscal_code
      ? selectedCity.fiscal_code
      : undefined;
  if (cityFiscalCodeValue !== undefined) {
    body.city_fiscal_code = { value: cityFiscalCodeValue };
  }

  const stateFiscalCodeValue =
    state_id.value !== null && selectedState?.fiscal_code
      ? selectedState.fiscal_code
      : undefined;
  if (stateFiscalCodeValue !== undefined) {
    body.state_fiscal_code = { value: stateFiscalCodeValue };
  }

  const districtValue =
    district.value !== initialValues.value.district
      ? district.value
      : undefined;
  if (districtValue !== undefined) {
    body.district = { value: districtValue };
  }

  const photoUrl = determinePhotoUrl();
  if (photoUrl !== undefined) {
    body.photo_url = { value: photoUrl };
  }

  return body;
};

const clearAddressFields = () => {
  address1.value = '';
  address1PartialOriginal.value = '';
  isAddress1Decrypted.value = false;
  address2.value = '';
  address2PartialOriginal.value = '';
  isAddress2Decrypted.value = false;
  city.value = '';
  state.value = '';
  state_id.value = null;
  city_id.value = null;
  district.value = '';
  clearCities();
};

const onCountryChange = async (val: number | null) => {
  country_id.value = val;
  clearAddressFields();

  if (country_id.value) {
    await loadStates(country_id.value);
  }

  await nextTick();
  zipInputRef.value?.focus?.();
};

const onStateChange = async (stateId: string | null) => {
  state_id.value = stateId;
  city_id.value = null;
  city.value = '';
  clearCities();

  if (stateId) {
    await loadCities(stateId);
  }
};

watch(isStateMenuOpen, (isOpen) => {
  if (!isOpen) {
    stateSearchQuery.value = '';
  }
});

watch(isCityMenuOpen, (isOpen) => {
  if (!isOpen) {
    citySearchQuery.value = '';
  }
});

const updateAddressFromZipcode = async (response: {
  address_1: string;
  address_2?: string | null;
  city: string;
  state: string;
  district: string;
}) => {
  address1.value = response.address_1;
  address1PartialOriginal.value = response.address_1;
  isAddress1Decrypted.value = true;
  address2.value = response.address_2 ?? null;
  address2PartialOriginal.value = response.address_2 ?? '';
  isAddress2Decrypted.value = true;
  district.value = response.district;

  if (country_id.value) {
    await loadStates(country_id.value);

    const stateValue = response.state.trim();
    const stateMatch = stateValue.match(/^(.+?)\s*\(([^)]+)\)$/);
    const stateName = stateMatch ? stateMatch[1].trim() : stateValue;
    const stateAbbreviation = stateMatch ? stateMatch[2].trim() : null;

    const foundState = states.value.find(
      (s) =>
        s.state.toLowerCase() === stateName.toLowerCase() ||
        (stateAbbreviation &&
          s.abbreviation?.toLowerCase() === stateAbbreviation.toLowerCase()) ||
        s.state.toLowerCase() === stateValue.toLowerCase() ||
        s.abbreviation?.toLowerCase() === stateValue.toLowerCase()
    );

    if (foundState) {
      state_id.value = foundState.id_zipcode_state;
      state.value = foundState.abbreviation
        ? `${foundState.state} (${foundState.abbreviation})`
        : foundState.state;
      await loadCities(foundState.id_zipcode_state);

      const foundCity = cities.value.find(
        (c) => c.city.toLowerCase() === response.city.toLowerCase()
      );

      if (foundCity) {
        city_id.value = foundCity.id_zipcode_city;
        city.value = foundCity.city;
      }
    }
  }
};

const viewZipcode = async () => {
  if (isInitializing.value) return;

  if (!country_id.value || !zip_code.value) {
    return;
  }

  const params: ViewZipcodeRequest = {
    country_id: country_id.value,
    zipcode: zip_code.value,
  };

  const response = await userStore.viewZipcode(params);
  if (response) {
    await updateAddressFromZipcode(response);
  }
};

const isInitializing = ref(true);
const initialZipCode = ref<string | null>(null);

const loadAdministratorAccounts = async () => {
  if (!isAdministrator.value) return;
  const accounts = await accountStore.listAllAccounts();
  if (accounts) {
    accountsOptions.value = accounts;
  }
};

const loadAccounts = async () => {
  await loadAdministratorAccounts();
};

const loadUserData = async () => {
  if (!userId.value) return;

  await loadAccounts();

  const responseUser = await userStore.viewUserById(userId.value);
  if (responseUser) {
    accountId.value = responseUser.account?.account_id ?? null;
    initialValues.value.account_id = accountId.value;
    const emailPartial = responseUser.email_partial ?? '';
    emailPartialOriginal.value = emailPartial;
    email.value = emailPartial;
    initialValues.value.email = emailPartial;
    isEmailDecrypted.value = false;

    phone_ddi.value = responseUser.user_info?.phone_ddi ?? null;
    initialValues.value.phone_ddi = phone_ddi.value;

    const phonePartial = responseUser.user_info?.phone_partial ?? '';
    phonePartialOriginal.value = phonePartial;
    initialValues.value.phone = phonePartial;
    if (phonePartial.includes('*')) {
      phone.value = null;
    }
    if (!phonePartial.includes('*')) {
      phone.value = phonePartial.replaceAll(/\D/g, '');
    }
    isPhoneDecrypted.value = false;

    name.value = responseUser.user_info?.name ?? null;
    initialValues.value.name = name.value;

    last_name.value = responseUser.user_info?.last_name ?? null;
    initialValues.value.last_name = last_name.value;

    birth_date.value = responseUser.user_info?.birth_date ?? null;
    initialValues.value.birth_date = birth_date.value;

    photo.value = responseUser.user_info?.photo ?? null;
    photoPreview.value = responseUser.user_info?.photo ?? null;
    photoRemoved.value = false;

    user_document_type_id.value =
      responseUser.user_document?.user_document_type?.user_document_type_id ??
      null;
    initialValues.value.user_document_type_id = user_document_type_id.value;

    const documentPartial = responseUser.user_document?.document_partial ?? '';
    documentPartialOriginal.value = documentPartial;
    initialValues.value.document = documentPartial;
    document.value = null;
    isDocumentDecrypted.value = false;

    country_id.value = responseUser.user_address?.country?.country_id ?? null;
    initialValues.value.country_id = country_id.value;

    zip_code.value = responseUser.user_address?.zip_code ?? null;
    initialValues.value.zip_code = zip_code.value;
    initialZipCode.value = zip_code.value;

    const address1Partial = responseUser.user_address?.address1_partial ?? '';
    address1PartialOriginal.value = address1Partial;
    initialValues.value.address1 = address1Partial;
    if (address1Partial.includes('*')) {
      address1.value = null;
    }
    if (!address1Partial.includes('*')) {
      address1.value = address1Partial;
    }
    isAddress1Decrypted.value = false;

    const address2Partial = responseUser.user_address?.address2_partial ?? '';
    address2PartialOriginal.value = address2Partial;
    initialValues.value.address2 = address2Partial;
    if (address2Partial && address2Partial.includes('*')) {
      address2.value = null;
    }
    if (address2Partial && !address2Partial.includes('*')) {
      address2.value = address2Partial;
    }
    if (!address2Partial) {
      address2.value = null;
    }
    isAddress2Decrypted.value = false;

    city.value = responseUser.user_address?.city ?? null;
    initialValues.value.city = city.value;

    state.value = responseUser.user_address?.state ?? null;
    initialValues.value.state = state.value;

    district.value = responseUser.user_address?.district ?? null;
    initialValues.value.district = district.value;

    user_status_id.value = responseUser.user_status?.user_status_id ?? null;
    initialValues.value.user_status_id = user_status_id.value;

    if (country_id.value) {
      await loadStates(country_id.value);

      if (state.value) {
        const stateValue = state.value.trim();
        const stateMatch = stateValue.match(/^(.+?)\s*\(([^)]+)\)$/);
        const stateName = stateMatch ? stateMatch[1].trim() : stateValue;
        const stateAbbreviation = stateMatch ? stateMatch[2].trim() : null;

        const foundState = states.value.find(
          (s) =>
            s.state.toLowerCase() === stateName.toLowerCase() ||
            (stateAbbreviation &&
              s.abbreviation?.toLowerCase() ===
                stateAbbreviation.toLowerCase()) ||
            s.state.toLowerCase() === stateValue.toLowerCase() ||
            s.abbreviation?.toLowerCase() === stateValue.toLowerCase()
        );

        if (foundState) {
          state_id.value = foundState.id_zipcode_state;
          state.value = foundState.abbreviation
            ? `${foundState.state} (${foundState.abbreviation})`
            : foundState.state;
          await loadCities(foundState.id_zipcode_state);

          if (city.value) {
            const foundCity = cities.value.find(
              (c) => c.city.toLowerCase() === city.value?.toLowerCase()
            );

            if (foundCity) {
              city_id.value = foundCity.id_zipcode_city;
            }
          }
        }
      }
    }
  }

  await nextTick();
  isInitializing.value = false;
};

onMounted(async () => {
  await loadUserData();
});

watch(isVisible, async (visible) => {
  if (visible && userId.value) {
    isInitializing.value = true;
    initialZipCode.value = null;
    await loadUserData();
    await nextTick();
    isInitializing.value = false;
  }
});

watch(password, () => {
  confirmPassword.value = null;
});

let timer: number | null = null;
watch(
  zip_code,
  (newValue, oldValue) => {
    if (isInitializing.value) return;

    if (newValue === oldValue || oldValue === undefined) return;

    if (newValue === initialZipCode.value) return;

    if (!country_id.value || !zip_code.value || zip_code.value.length < 8)
      return;

    if (timer) (globalThis as Window & typeof globalThis).clearTimeout(timer);

    timer = (globalThis as Window & typeof globalThis).setTimeout(() => {
      viewZipcode();
    }, 400);
  },
  { immediate: false }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="1200">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="userStore.loading">
      <VOverlay
        :model-value="userStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VCard class="mx-2 my-2">
      <VCardTitle class="pa-6 pb-4 text-h5">
        {{ $t('edit_user') }}
      </VCardTitle>
      <VDivider />

      <VTabs :model-value="tab" @update:model-value="onTabChange" class="px-6">
        <VTab value="user_data">{{ t('user_data') }}</VTab>
        <VTab value="additional_info">{{ t('additional_info') }}</VTab>
        <VTab value="address">{{ t('address') }}</VTab>
      </VTabs>
      <VDivider />

      <VCard flat>
        <VCardText class="pa-6">
          <VWindow
            :model-value="tab"
            @update:model-value="onTabChange"
            class="disable-tab-transition"
          >
            <VWindowItem value="user_data">
              <VForm class="mt-4" ref="refFormStep1" @submit.prevent>
                <VRow>
                  <VCol
                    cols="12"
                    md="4"
                    class="d-flex flex-column align-center justify-center pa-6"
                  >
                    <div class="d-flex flex-column align-center gap-3 w-100">
                      <VAvatar
                        size="200"
                        class="cursor-pointer"
                        @click="openFileSelector"
                      >
                        <VImg
                          v-if="photoPreview || photo"
                          :src="photoPreview || photo || ''"
                        />
                        <VImg
                          v-else
                          :src="'/images/svg/avatar-default.svg'"
                          alt="Avatar"
                        />
                        <div
                          class="photo-overlay d-flex align-center justify-center"
                        >
                          <VIcon icon="tabler-camera" size="32" color="white" />
                        </div>
                      </VAvatar>
                      <div class="d-flex flex-column gap-2 w-100">
                        <VBtn
                          color="primary"
                          variant="outlined"
                          size="small"
                          block
                          @click="openFileSelector"
                        >
                          <VIcon icon="tabler-upload" class="me-2" />
                          {{
                            photo || photoPreview
                              ? $t('change_photo')
                              : $t('add_photo')
                          }}
                        </VBtn>
                        <VBtn
                          v-if="photo || photoPreview"
                          color="error"
                          variant="outlined"
                          size="small"
                          block
                          @click="removePhoto"
                        >
                          <VIcon icon="tabler-trash" class="me-2" />
                          {{ $t('remove_photo') }}
                        </VBtn>
                      </div>
                    </div>
                  </VCol>
                  <VDivider vertical class="d-none d-md-block" />
                  <VCol cols="12" md="8" class="pa-6">
                    <VRow class="mb-2">
                      <VCol v-if="isAdministrator" md="6" cols="12">
                        <AppTextField
                          v-model="emailFormatted"
                          type="email"
                          :label="$t('email') + ':'"
                          :placeholder="$t('email')"
                          :rules="[
                            emailValidator,
                            requiredValidator(
                              emailFormatted,
                              $t('email_required')
                            ),
                          ]"
                          @focus="startEditEmail"
                          @click="startEditEmail"
                        >
                          <template #append-inner>
                            <VIcon
                              :icon="
                                isEmailDecrypted
                                  ? 'tabler-eye-off'
                                  : 'tabler-eye'
                              "
                              class="cursor-pointer"
                              :class="{ 'opacity-50': isLoadingEmail }"
                              @click.stop="toggleEmailVisibility"
                            />
                          </template>
                        </AppTextField>
                      </VCol>

                      <VCol v-if="isAdministrator" cols="12" md="6">
                        <AppAutocomplete
                          v-model="accountId"
                          :items="accountsOptions"
                          item-title="name"
                          item-value="account_id"
                          :label="$t('account') + ':'"
                          :placeholder="$t('select_account')"
                        />
                      </VCol>

                      <VCol v-if="!isAdministrator" md="6" cols="12">
                        <AppTextField
                          v-model="emailFormatted"
                          type="email"
                          :label="$t('email') + ':'"
                          :placeholder="$t('email')"
                          :rules="[
                            emailValidator,
                            requiredValidator(
                              emailFormatted,
                              $t('email_required')
                            ),
                          ]"
                          @focus="startEditEmail"
                          @click="startEditEmail"
                        >
                          <template #append-inner>
                            <VIcon
                              :icon="
                                isEmailDecrypted
                                  ? 'tabler-eye-off'
                                  : 'tabler-eye'
                              "
                              class="cursor-pointer"
                              :class="{ 'opacity-50': isLoadingEmail }"
                              @click.stop="toggleEmailVisibility"
                            />
                          </template>
                        </AppTextField>
                      </VCol>

                      <VCol v-if="!isAdministrator" md="6" cols="12">
                        <VLabel>{{ $t('status') }}:</VLabel>
                        <AppAutocomplete
                          item-title="text"
                          item-value="id"
                          :items="itemsStatus"
                          v-model="user_status_id"
                          :placeholder="$t('select_state')"
                        />
                      </VCol>
                    </VRow>
                    <VRow class="mb-2">
                      <VCol cols="12" md="6">
                        <AppTextField
                          id="new-password"
                          name="new-password"
                          v-model="password"
                          :label="$t('password') + ':'"
                          :placeholder="$t('password')"
                          :type="isPasswordVisible ? 'text' : 'password'"
                          :autocomplete="
                            isPasswordVisible ? 'off' : 'new-password'
                          "
                          autocapitalize="off"
                          autocorrect="off"
                          spellcheck="false"
                          :append-inner-icon="
                            isPasswordVisible ? 'tabler-eye-off' : 'tabler-eye'
                          "
                          :rules="[rules.passwordMinIfFilled]"
                          @click:append-inner="
                            isPasswordVisible = !isPasswordVisible
                          "
                        />
                      </VCol>

                      <VCol cols="12" md="6">
                        <AppTextField
                          id="confirm-new-password"
                          name="confirm-new-password"
                          v-model="confirmPassword"
                          :label="$t('confirm_password') + ':'"
                          :placeholder="$t('confirm_password')"
                          :type="isConfirmVisible ? 'text' : 'password'"
                          :autocomplete="
                            isConfirmVisible ? 'off' : 'new-password'
                          "
                          autocapitalize="off"
                          autocorrect="off"
                          spellcheck="false"
                          :append-inner-icon="
                            isConfirmVisible ? 'tabler-eye-off' : 'tabler-eye'
                          "
                          :rules="[
                            rules.confirmRequiredIfPassword,
                            rules.confirmMatches,
                          ]"
                          @click:append-inner="
                            isConfirmVisible = !isConfirmVisible
                          "
                        />
                      </VCol>
                    </VRow>
                    <VRow v-if="isAdministrator" class="mb-2">
                      <VCol md="6" cols="12">
                        <VLabel>{{ $t('status') }}:</VLabel>
                        <AppAutocomplete
                          item-title="text"
                          item-value="id"
                          :items="itemsStatus"
                          v-model="user_status_id"
                          :placeholder="$t('select_state')"
                        />
                      </VCol>
                    </VRow>
                  </VCol>
                </VRow>
                <VCardText class="d-flex justify-end flex-wrap gap-3 mt-4 pt-4">
                  <VBtn
                    variant="tonal"
                    color="secondary"
                    @click="isVisible = false"
                  >
                    {{ $t('cancel') }}
                  </VBtn>
                  <VBtn @click="goNext">{{ $t('next') }}</VBtn>
                </VCardText>
              </VForm>
            </VWindowItem>

            <VWindowItem value="additional_info">
              <VForm class="mt-4" ref="refFormStep2" @submit.prevent>
                <VRow class="mb-2">
                  <VCol cols="12" md="6">
                    <div>
                      <VLabel class="mb-1 text-body-2"
                        >{{ $t('phone_ddi') }}:</VLabel
                      >
                      <VMenu v-model="isCountryMenuOpen">
                        <template #activator="{ props: menuProps }">
                          <VTextField
                            v-bind="menuProps"
                            :model-value="
                              countryCodes.find((c) => c.value === phone_ddi)
                                ?.title || ''
                            "
                            :placeholder="$t('select_phone_ddi')"
                            variant="outlined"
                            readonly
                            append-inner-icon="tabler-chevron-down"
                          />
                        </template>
                        <VCard>
                          <VCardText class="pa-2">
                            <AppTextField
                              v-model="countrySearchQuery"
                              :placeholder="$t('search') + '...'"
                              prepend-inner-icon="tabler-search"
                              density="compact"
                              hide-details
                              autofocus
                              @click.stop
                            />
                          </VCardText>
                          <VDivider />
                          <VList max-height="300" style="overflow-y: auto">
                            <VListItem
                              v-for="(item, index) in filteredCountryCodes"
                              :key="index"
                              :value="item.value"
                              @click="
                                () => {
                                  phone_ddi = item.value;
                                  isCountryMenuOpen = false;
                                }
                              "
                              :active="phone_ddi === item.value"
                            >
                              <VListItemTitle>{{ item.title }}</VListItemTitle>
                            </VListItem>
                          </VList>
                        </VCard>
                      </VMenu>
                    </div>
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="phoneFormatted"
                      type="tel"
                      :label="$t('phone') + ':'"
                      :placeholder="$t('phone')"
                      maxlength="15"
                      @focus="startEditPhone"
                      @click="startEditPhone"
                    >
                      <template #append-inner>
                        <VIcon
                          :icon="
                            isPhoneDecrypted ? 'tabler-eye-off' : 'tabler-eye'
                          "
                          class="cursor-pointer"
                          :class="{ 'opacity-50': isLoadingPhone }"
                          @click.stop="togglePhoneVisibility"
                        />
                      </template>
                    </AppTextField>
                  </VCol>

                  <VCol cols="12">
                    <VDivider />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="name"
                      :label="$t('name') + ':'"
                      :placeholder="$t('name')"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="last_name"
                      :label="$t('last_name') + ':'"
                      :placeholder="$t('last_name')"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppSelect
                      :model-value="user_document_type_id"
                      :items="itemsDocuments"
                      :label="$t('document_type') + ':'"
                      :placeholder="$t('document_type')"
                      @update:model-value="
                        user_document_type_id = $event;
                        document = null;
                      "
                    />
                  </VCol>

                  <VCol v-if="isCPF || isCNPJ" cols="12" md="6">
                    <AppTextField
                      v-if="isDocumentDecrypted"
                      v-model="document"
                      :label="docLabel + ':'"
                      :placeholder="docPlaceholder"
                      :rules="docRules"
                      v-maska="docMask"
                      inputmode="numeric"
                      @blur="handleDocumentBlur"
                    >
                      <template #append-inner>
                        <VIcon
                          :icon="'tabler-eye-off'"
                          class="cursor-pointer"
                          :class="{ 'opacity-50': isLoadingDocument }"
                          @click.stop="toggleDocumentVisibility"
                        />
                      </template>
                    </AppTextField>
                    <AppTextField
                      v-else
                      :model-value="documentPartialOriginal"
                      :label="docLabel + ':'"
                      :placeholder="docPlaceholder"
                      :rules="docRules"
                      readonly
                      @focus="startEditDocument"
                      @click="startEditDocument"
                    >
                      <template #append-inner>
                        <VIcon
                          :icon="'tabler-eye'"
                          class="cursor-pointer"
                          :class="{ 'opacity-50': isLoadingDocument }"
                          @click.stop="toggleDocumentVisibility"
                        />
                      </template>
                    </AppTextField>
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppDateTimePicker
                      v-model="birth_date"
                      :label="$t('birth_date') + ':'"
                      :placeholder="$t('birth_date')"
                    />
                  </VCol>
                </VRow>
                <VCardText class="d-flex justify-end flex-wrap gap-3 mt-4 pt-4">
                  <VBtn variant="tonal" color="secondary" @click="goPrev">
                    {{ $t('previous') }}
                  </VBtn>
                  <VBtn @click="goNext">{{ $t('next') }}</VBtn>
                </VCardText>
              </VForm>
            </VWindowItem>

            <VWindowItem value="address">
              <VForm class="mt-4" ref="refFormEditUser" @submit.prevent>
                <VRow class="mb-2">
                  <VCol cols="12" md="6">
                    <AppSelect
                      :label="$t('country') + ':'"
                      :placeholder="$t('country')"
                      :model-value="country_id"
                      :items="itemsCountry"
                      @update:model-value="onCountryChange"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      ref="zipInputRef"
                      v-model="zip_code"
                      :label="$t('zip_code') + ':'"
                      :placeholder="$t('zip_code')"
                      :rules="[
                        requiredValidator(zip_code, $t('zip_code_required')),
                      ]"
                      :disabled="!country_id"
                      @blur="viewZipcode"
                      @keydown.enter.prevent="viewZipcode"
                      maxlength="8"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <div>
                      <VLabel class="mb-1 text-body-2"
                        >{{ $t('state') }}:</VLabel
                      >
                      <VMenu v-model="isStateMenuOpen">
                        <template #activator="{ props: menuProps }">
                          <VTextField
                            v-bind="menuProps"
                            :model-value="
                              filteredStates.find((s) => s.value === state_id)
                                ?.title || ''
                            "
                            :placeholder="$t('state')"
                            variant="outlined"
                            readonly
                            :disabled="!country_id"
                            append-inner-icon="tabler-chevron-down"
                          />
                        </template>
                        <VCard>
                          <VCardText class="pa-2">
                            <AppTextField
                              v-model="stateSearchQuery"
                              :placeholder="$t('search') + '...'"
                              prepend-inner-icon="tabler-search"
                              density="compact"
                              hide-details
                              autofocus
                              @click.stop
                            />
                          </VCardText>
                          <VDivider />
                          <VList max-height="300" style="overflow-y: auto">
                            <VListItem
                              v-for="(item, index) in filteredStates"
                              :key="index"
                              :value="item.value"
                              @click="
                                () => {
                                  onStateChange(item.value);
                                  state = item.title;
                                  isStateMenuOpen = false;
                                }
                              "
                              :active="state_id === item.value"
                            >
                              <VListItemTitle>{{ item.title }}</VListItemTitle>
                            </VListItem>
                          </VList>
                        </VCard>
                      </VMenu>
                    </div>
                  </VCol>
                  <VCol cols="12" md="6">
                    <div>
                      <VLabel class="mb-1 text-body-2"
                        >{{ $t('city') }}:</VLabel
                      >
                      <VMenu v-model="isCityMenuOpen">
                        <template #activator="{ props: menuProps }">
                          <VTextField
                            v-bind="menuProps"
                            :model-value="
                              filteredCities.find((c) => c.value === city_id)
                                ?.title || ''
                            "
                            :placeholder="$t('city')"
                            variant="outlined"
                            readonly
                            :disabled="!state_id || !country_id"
                            append-inner-icon="tabler-chevron-down"
                          />
                        </template>
                        <VCard>
                          <VCardText class="pa-2">
                            <AppTextField
                              v-model="citySearchQuery"
                              :placeholder="$t('search') + '...'"
                              prepend-inner-icon="tabler-search"
                              density="compact"
                              hide-details
                              autofocus
                              @click.stop
                            />
                          </VCardText>
                          <VDivider />
                          <VList max-height="300" style="overflow-y: auto">
                            <VListItem
                              v-for="(item, index) in filteredCities"
                              :key="index"
                              :value="item.value"
                              @click="
                                () => {
                                  city_id = item.value;
                                  city = item.title;
                                  isCityMenuOpen = false;
                                }
                              "
                              :active="city_id === item.value"
                            >
                              <VListItemTitle>{{ item.title }}</VListItemTitle>
                            </VListItem>
                          </VList>
                        </VCard>
                      </VMenu>
                    </div>
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="address1Formatted"
                      :disabled="!country_id"
                      :label="$t('address') + ':'"
                      :placeholder="$t('address')"
                      @focus="startEditAddress1"
                      @click="startEditAddress1"
                    >
                      <template #append-inner>
                        <VIcon
                          :icon="
                            isAddress1Decrypted
                              ? 'tabler-eye-off'
                              : 'tabler-eye'
                          "
                          class="cursor-pointer"
                          :class="{ 'opacity-50': isLoadingAddress1 }"
                          @click.stop="toggleAddress1Visibility"
                        />
                      </template>
                    </AppTextField>
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="address2Formatted"
                      :disabled="!country_id"
                      :label="$t('address_secondary') + ':'"
                      :placeholder="$t('address_secondary')"
                      @focus="startEditAddress2"
                      @click="startEditAddress2"
                    >
                      <template #append-inner>
                        <VIcon
                          :icon="
                            isAddress2Decrypted
                              ? 'tabler-eye-off'
                              : 'tabler-eye'
                          "
                          class="cursor-pointer"
                          :class="{ 'opacity-50': isLoadingAddress2 }"
                          @click.stop="toggleAddress2Visibility"
                        />
                      </template>
                    </AppTextField>
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="district"
                      :disabled="!country_id"
                      :label="$t('district') + ':'"
                      :placeholder="$t('district')"
                    />
                  </VCol>
                </VRow>
                <VCardText class="d-flex justify-end flex-wrap gap-3 mt-4 pt-4">
                  <VBtn variant="tonal" color="secondary" @click="goPrev">
                    {{ $t('previous') }}
                  </VBtn>
                  <VBtn
                    variant="tonal"
                    color="secondary"
                    @click="isVisible = false"
                  >
                    {{ $t('cancel') }}
                  </VBtn>
                  <VBtn :disabled="!hasChanges" @click="updateUser">
                    {{ $t('save') }}
                  </VBtn>
                </VCardText>
              </VForm>
            </VWindowItem>
          </VWindow>
        </VCardText>
      </VCard>
    </VCard>
  </VDialog>

  <!-- Crop Image Dialog -->
  <VDialog v-model="isCropModalOpen" max-width="500" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{ $t('crop_image') }}</span>
        <IconBtn @click="cancelCrop">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>

      <VCardText>
        <div class="crop-container position-relative">
          <img
            ref="cropImageRef"
            :src="cropDialog.imageSrc"
            alt="Para cortar"
            class="crop-image"
            @load="initializeCrop"
          />

          <div
            class="crop-area"
            :style="{
              left: `${cropArea.x}px`,
              top: `${cropArea.y}px`,
              width: `${cropArea.width}px`,
              height: `${cropArea.height}px`,
            }"
            @mousedown.stop="startCropDrag"
            @touchstart.stop="startCropDrag"
          >
            <div class="crop-area-border"></div>
            <div class="crop-area-handles">
              <div
                class="crop-handle crop-handle-nw"
                @mousedown.stop="startCropResize('nw', $event)"
                @touchstart.stop="startCropResize('nw', $event)"
              ></div>
              <div
                class="crop-handle crop-handle-ne"
                @mousedown.stop="startCropResize('ne', $event)"
                @touchstart.stop="startCropResize('ne', $event)"
              ></div>
              <div
                class="crop-handle crop-handle-sw"
                @mousedown.stop="startCropResize('sw', $event)"
                @touchstart.stop="startCropResize('sw', $event)"
              ></div>
              <div
                class="crop-handle crop-handle-se"
                @mousedown.stop="startCropResize('se', $event)"
                @touchstart.stop="startCropResize('se', $event)"
              ></div>
            </div>
          </div>
        </div>

        <canvas ref="cropCanvasRef" style="display: none"></canvas>
      </VCardText>

      <VCardText class="d-flex justify-end gap-3 flex-wrap">
        <VBtn variant="tonal" color="secondary" @click="cancelCrop">
          {{ $t('cancel') }}
        </VBtn>
        <VBtn color="primary" @click="cropImage">
          {{ $t('apply_crop') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>

<style lang="scss" scoped>
.crop-container {
  width: 100%;
  max-width: 400px;
  height: 400px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}

.crop-image {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  user-select: none;
  pointer-events: none;
}

.crop-area {
  position: absolute;
  border: 2px solid rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.05);
  cursor: move;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.5);
  z-index: 10;
  touch-action: none;
}

.crop-area-border {
  position: absolute;
  inset: 0;
  border: 2px dashed rgba(255, 255, 255, 0.8);
  pointer-events: none;
}

.crop-area-handles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: rgb(var(--v-theme-primary));
  border: 2px solid white;
  border-radius: 50%;
  pointer-events: all;
  cursor: nwse-resize;
  z-index: 11;
}

.crop-handle-nw {
  top: -6px;
  left: -6px;
  cursor: nwse-resize;
}

.crop-handle-ne {
  top: -6px;
  right: -6px;
  cursor: nesw-resize;
}

.crop-handle-sw {
  bottom: -6px;
  left: -6px;
  cursor: nesw-resize;
}

.crop-handle-se {
  bottom: -6px;
  right: -6px;
  cursor: nwse-resize;
}

.photo-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
  z-index: 1;
  border-radius: 50%;
}

.cursor-pointer:hover .photo-overlay {
  opacity: 1;
}
</style>
