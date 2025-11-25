<script lang="ts" setup>
import { computed, onMounted, nextTick } from 'vue';
import { useUsersStore } from '@/@webcore/stores/user';
import { useAccountStore } from '@/@webcore/stores/account';
import { CreateUserRequest } from '@core/schema/user/createUser/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { EUserDocumentType } from '@core/common/enums/EUserDocumentType';
import { ECountry } from '@core/common/enums/ECountry';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { getAdministrator, getUser } from '@/@webcore/localStorage/user';
import { EColor } from '@core/common/enums/EColor';

const userStore = useUsersStore();
const accountStore = useAccountStore();
const { items: countryCodes } = useCountryCodes();
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
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const formatPhone = (value: string | null | undefined): string => {
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
};

const phoneFormatted = computed({
  get: () => formatPhone(phone.value),
  set: (value: string) => {
    phone.value = value.replaceAll(/\D/g, '');
  },
});

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return true;
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

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

const requiredMsg = (label: string) => t('field_required', { field: label });

const docRules = computed(() => [
  (v: string | null) =>
    (!!v && onlyDigits(v).length > 0) || requiredMsg(docLabel.value),
  (v: string | null) => {
    if (!v) return true;
    const digits = onlyDigits(v);
    if (isCPF.value) return cpfRegex.test(digits) || t('cpf_invalid');
    if (isCNPJ.value) return cnpjRegex.test(digits) || t('cnpj_invalid');
    return true;
  },
]);

const tab = ref('user_data');

const email = ref<string | null>(null);
const password = ref<string | null>(null);
const confirmPassword = ref<string | null>(null);
const phone_ddi = ref<string | null>('55');
const phone = ref<string | null>(null);
const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const birth_date = ref<string | null>(null);
const user_document_type_id = ref<string | null>(null);
const document = ref<string | null>(null);
const country_id = ref<number | null>(null);
const zip_code = ref<string | null>(null);
const address1 = ref<string | null>(null);
const address2 = ref<string | null>(null);
const city = ref<string | null>(null);
const state = ref<string | null>(null);
const district = ref<string | null>(null);

const isPasswordVisible = ref(false);
const refFormAddUser = ref<VForm>();
const isConfirmVisible = ref(false);

const refFormStep1 = ref<VForm>();
const refFormStep2 = ref<VForm>();

const zipInputRef = ref<HTMLInputElement | null>(null);

const photo = ref<string | null>(null);
const photoFile = ref<File | null>(null);
const photoPreview = ref<string | null>(null);
const isCropModalOpen = ref(false);
const isUploadingPhoto = ref(false);
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

const validateStep1 = async (): Promise<boolean> => {
  const validation = await refFormStep1.value?.validate();
  return validation?.valid ?? false;
};

const validateStep2 = async (): Promise<boolean> => {
  const validation = await refFormStep2.value?.validate();
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

const updateAddressFields = (response: {
  address_1: string;
  address_2?: string | null;
  city: string;
  state: string;
  district: string;
}) => {
  address1.value = response.address_1;
  address2.value = response.address_2 ?? null;
  city.value = response.city;
  state.value = response.state;
  district.value = response.district;
};

const viewZipcode = async () => {
  if (!country_id.value || !zip_code.value) {
    return;
  }

  const params: ViewZipcodeRequest = {
    country_id: country_id.value,
    zipcode: zip_code.value,
  };

  const response = await userStore.viewZipcode(params);
  if (response) {
    updateAddressFields(response);
  }
};

const validateRequiredFields = (): boolean => {
  return !!(
    email.value &&
    password.value &&
    phone_ddi.value &&
    phone.value &&
    name.value &&
    last_name.value &&
    birth_date.value &&
    user_document_type_id.value &&
    document.value &&
    country_id.value &&
    zip_code.value &&
    address1.value &&
    city.value &&
    state.value &&
    district.value
  );
};

const buildUserPayload = () => {
  const phoneNumber = phone.value!.replaceAll(/\D/g, '');

  return {
    email: email.value!,
    password: password.value!,
    account_id:
      isAdministrator.value && accountId.value ? accountId.value : undefined,
    user_info: {
      phone_ddi: phone_ddi.value!,
      phone: phoneNumber,
      name: name.value!,
      last_name: last_name.value!,
      birth_date: birth_date.value,
    },
    user_document: {
      user_document_type_id: user_document_type_id.value!,
      document: document.value!,
    },
    user_address: {
      country_id: country_id.value!,
      zip_code: zip_code.value!,
      address1: address1.value!,
      address2: address2.value,
      city: city.value!,
      state: state.value!,
      district: district.value!,
    },
  };
};

const addUser = async () => {
  const validateForm = await refFormAddUser?.value?.validate();
  if (!validateForm?.valid) return;

  if (!validateRequiredFields()) {
    return;
  }

  const payload = buildUserPayload();
  const result = await userStore.addUser(payload, photoFile.value);

  if (result) {
    isVisible.value = false;
    await userStore.listUsers();
  }
};

const clearAddressFields = () => {
  address1.value = '';
  address2.value = '';
  city.value = '';
  state.value = '';
  district.value = '';
};

const onCountryChange = async (val: number | null) => {
  country_id.value = val;
  clearAddressFields();

  if (country_id.value && zip_code.value) {
    await viewZipcode();
    return;
  }

  await nextTick();
  zipInputRef.value?.focus?.();
};

const resetForm = () => {
  name.value = null;
  accountId.value = null;
  if (!isAdministrator.value && currentUser.value?.account_id) {
    accountId.value = currentUser.value.account_id;
  }
  photo.value = null;
  photoFile.value = null;
  photoPreview.value = null;
  cropDialog.value.imageSrc = '';
  cropDialog.value.croppedImage = '';
  refFormAddUser.value?.resetValidation();
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

const getEventCoordinates = (
  e: MouseEvent | TouchEvent
): { x: number; y: number } => {
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  return { x: clientX, y: clientY };
};

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
  cropDialog.value.croppedImage = '';
};

const loadAdministratorAccounts = async () => {
  if (!isAdministrator.value) return;
  const accounts = await accountStore.listAllAccounts();
  if (accounts) {
    accountsOptions.value = accounts;
  }
};

const setCurrentUserAccount = () => {
  if (isAdministrator.value) return;
  if (currentUser.value?.account_id) {
    accountId.value = currentUser.value.account_id;
  }
};

const loadAccounts = async () => {
  await loadAdministratorAccounts();
  setCurrentUserAccount();
};

watch(isVisible, async (visible) => {
  if (visible) {
    resetForm();
    await loadAccounts();
  }
});

onMounted(async () => {
  await loadAccounts();
  setCurrentUserAccount();
});

let timer: number | null = null;
watch(zip_code, () => {
  if (!country_id.value || !zip_code.value || zip_code.value.length < 8) return;

  if (timer) (globalThis as Window & typeof globalThis).clearTimeout(timer);

  timer = (globalThis as Window & typeof globalThis).setTimeout(() => {
    viewZipcode();
  }, 400);
});

onMounted(resetForm);
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
        {{ $t('add_user') }}
      </VCardTitle>
      <VDivider />

      <VTabs v-model="tab" class="px-6">
        <VTab value="user_data">{{ t('user_data') }}</VTab>
        <VTab value="additional_info">{{ t('additional_info') }}</VTab>
        <VTab value="address">{{ t('address') }}</VTab>
      </VTabs>
      <VDivider />

      <VCard flat>
        <VCardText class="pa-6">
          <VWindow v-model="tab" class="disable-tab-transition">
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
                          {{ photo ? $t('change_photo') : $t('add_photo') }}
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
                      <VCol v-if="isAdministrator" cols="12" md="6">
                        <AppTextField
                          v-model="email"
                          type="email"
                          :label="$t('email') + ':'"
                          :placeholder="$t('email')"
                          :rules="[
                            emailValidator,
                            requiredValidator(email, $t('email_required')),
                          ]"
                        />
                      </VCol>

                      <VCol v-if="!isAdministrator" cols="12">
                        <AppTextField
                          v-model="email"
                          type="email"
                          :label="$t('email') + ':'"
                          :placeholder="$t('email')"
                          :rules="[
                            emailValidator,
                            requiredValidator(email, $t('email_required')),
                          ]"
                        />
                      </VCol>

                      <VCol v-if="isAdministrator" cols="12" md="6">
                        <AppAutocomplete
                          v-model="accountId"
                          :items="accountsOptions"
                          item-title="name"
                          item-value="account_id"
                          :label="$t('account') + ':'"
                          :placeholder="$t('select_account')"
                          :rules="[
                            requiredValidator(
                              accountId,
                              $t('account_required')
                            ),
                          ]"
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
                          :rules="[
                            rules.passwordMinIfFilled,
                            requiredValidator(
                              password,
                              $t('password_required')
                            ),
                          ]"
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
                      :rules="[
                        requiredValidator(phoneFormatted, $t('phone_required')),
                      ]"
                      maxlength="15"
                    />
                  </VCol>

                  <VCol cols="12">
                    <VDivider />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="name"
                      :label="$t('name') + ':'"
                      :placeholder="$t('name')"
                      :rules="[requiredValidator(name, $t('name_required'))]"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="last_name"
                      :label="$t('last_name') + ':'"
                      :placeholder="$t('last_name')"
                      :rules="[
                        requiredValidator(last_name, $t('last_name_required')),
                      ]"
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
                      v-model="document"
                      :label="docLabel + ':'"
                      :placeholder="docPlaceholder"
                      v-maska="docMask"
                      inputmode="numeric"
                      :rules="docRules"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <AppDateTimePicker
                      v-model="birth_date"
                      :label="$t('birth_date') + ':'"
                      :placeholder="$t('birth_date')"
                      :rules="[
                        requiredValidator(
                          birth_date,
                          $t('birth_date_required')
                        ),
                      ]"
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
              <VForm class="mt-4" ref="refFormAddUser" @submit.prevent>
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
                    <AppTextField
                      v-model="address1"
                      :disabled="!country_id"
                      :label="$t('address') + ':'"
                      :placeholder="$t('address')"
                      :rules="[
                        requiredValidator(address1, $t('address_required')),
                      ]"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="address2"
                      :disabled="!country_id"
                      :label="$t('address_secondary') + ':'"
                      :placeholder="$t('address_secondary')"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="city"
                      :disabled="!country_id"
                      :label="$t('city') + ':'"
                      :placeholder="$t('city')"
                      :rules="[requiredValidator(city, $t('city_required'))]"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="state"
                      :disabled="!country_id"
                      :label="$t('state') + ':'"
                      :placeholder="$t('state')"
                      :rules="[requiredValidator(state, $t('state_required'))]"
                    />
                  </VCol>
                  <VCol cols="12" md="6">
                    <AppTextField
                      v-model="district"
                      :disabled="!country_id"
                      :label="$t('district') + ':'"
                      :placeholder="$t('district')"
                      :rules="[
                        requiredValidator(district, $t('district_required')),
                      ]"
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
                  <VBtn @click="addUser"> {{ $t('save') }} </VBtn>
                </VCardText>
              </VForm>
            </VWindowItem>
          </VWindow>
        </VCardText>
      </VCard>
    </VCard>
  </VDialog>

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
        <VBtn color="primary" :loading="isUploadingPhoto" @click="cropImage">
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
  overflow: hidden;
  border-radius: 8px;
  background: rgba(var(--v-theme-surface-variant), 0.1);
  position: relative;
  user-select: none;
  touch-action: none;
}

.crop-image {
  display: block;
  max-width: 100%;
  max-height: 100%;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
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
