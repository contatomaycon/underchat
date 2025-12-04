<script lang="ts" setup>
import { computed, onMounted, nextTick, watch, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { useChatStore } from '@/@webcore/stores/chat';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { useStatesAndCities } from '@/composables/useStatesAndCities';
import { ViewZipcodeRequest } from '@core/schema/zipcode/viewZipcode/request.schema';
import { useUsersStore } from '@/@webcore/stores/user';
import { EUserDocumentType } from '@core/common/enums/EUserDocumentType';
import { ECountry } from '@core/common/enums/ECountry';
import { EColor } from '@core/common/enums/EColor';
import { VForm } from 'vuetify/components/VForm';
import { setUser } from '@/@webcore/localStorage/user';
import { UpdateAdditionalInfoRequest } from '@core/schema/accountSettings/updateAdditionalInfo/request.schema';
import { UpdateAddressRequest } from '@core/schema/accountSettings/updateAddress/request.schema';

const { t } = useI18n();
const accountSettingsStore = useAccountSettingsStore();
const chatStore = useChatStore();
const userStore = useUsersStore();
useSnackbarCleanup(accountSettingsStore);

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
} = useStatesAndCities();

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

const phone_ddi = ref<string | null>(null);
const phone = ref<string | null>(null);
const phonePartial = ref<string | null>(null);
const isPhoneDecrypted = ref(false);
const isLoadingPhone = ref(false);
const phoneHasBeenEdited = ref(false);

const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const birth_date = ref<string | null>(null);
const user_document_type_id = ref<string | null>(null);
const document = ref<string | null>(null);
const documentPartial = ref<string | null>(null);
const isDocumentDecrypted = ref(false);
const isLoadingDocument = ref(false);
const documentHasBeenEdited = ref(false);

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
  get: () => {
    if (phone.value) {
      return formatPhone(phone.value);
    }
    if (!phoneHasBeenEdited.value && phonePartial.value) {
      return phonePartial.value;
    }
    return '';
  },
  set: (value: string) => {
    phoneHasBeenEdited.value = true;
    const digits = value.replaceAll(/\D/g, '');
    phone.value = digits || null;
    if (digits) {
      isPhoneDecrypted.value = true;
    }
    if (!digits) {
      phone.value = null;
    }
  },
});

const documentFormatted = computed({
  get: () => {
    if (document.value) {
      return document.value;
    }
    if (!documentHasBeenEdited.value && documentPartial.value) {
      return documentPartial.value;
    }
    return '';
  },
  set: (value: string) => {
    if (!documentHasBeenEdited.value) {
      documentHasBeenEdited.value = true;
    }
    if (isCPF.value || isCNPJ.value) {
      const digits = value.replaceAll(/\D/g, '');
      document.value = digits || null;
    } else {
      document.value = value || null;
    }
    if (document.value) {
      isDocumentDecrypted.value = true;
    }
    if (!document.value) {
      document.value = null;
    }
  },
});

const togglePhoneVisibility = async () => {
  if (isPhoneDecrypted.value) {
    phone.value = null;
    phoneHasBeenEdited.value = false;
    isPhoneDecrypted.value = false;
    return;
  }

  isLoadingPhone.value = true;
  const decryptedPhone = await accountSettingsStore.getPhoneDecrypted();
  isLoadingPhone.value = false;

  if (decryptedPhone) {
    phone.value = decryptedPhone.replaceAll(/\D/g, '');
    isPhoneDecrypted.value = true;
  }
};

const toggleDocumentVisibility = async () => {
  if (isDocumentDecrypted.value) {
    document.value = null;
    documentHasBeenEdited.value = false;
    isDocumentDecrypted.value = false;
    return;
  }

  isLoadingDocument.value = true;
  const decryptedDocument = await accountSettingsStore.getDocumentDecrypted();
  isLoadingDocument.value = false;

  if (decryptedDocument) {
    documentHasBeenEdited.value = true;
    await nextTick();
    document.value = decryptedDocument.replaceAll(/\D/g, '');
    isDocumentDecrypted.value = true;
  }
};

const toggleAddress1Visibility = async () => {
  if (isAddress1Decrypted.value) {
    address1.value = null;
    address1HasBeenEdited.value = false;
    isAddress1Decrypted.value = false;
    return;
  }

  isLoadingAddress1.value = true;
  const decryptedAddress1 = await accountSettingsStore.getAddress1Decrypted();
  isLoadingAddress1.value = false;

  if (decryptedAddress1) {
    address1.value = decryptedAddress1;
    isAddress1Decrypted.value = true;
  }
};

const toggleAddress2Visibility = async () => {
  if (isAddress2Decrypted.value) {
    address2.value = null;
    address2HasBeenEdited.value = false;
    isAddress2Decrypted.value = false;
    return;
  }

  isLoadingAddress2.value = true;
  const decryptedAddress2 = await accountSettingsStore.getAddress2Decrypted();
  isLoadingAddress2.value = false;

  if (decryptedAddress2) {
    address2.value = decryptedAddress2;
    isAddress2Decrypted.value = true;
  }
};

const address1Formatted = computed({
  get: () => {
    if (address1.value) {
      return address1.value;
    }
    if (!address1HasBeenEdited.value && address1Partial.value) {
      return address1Partial.value;
    }
    return '';
  },
  set: (value: string) => {
    address1HasBeenEdited.value = true;
    address1.value = value || null;
    if (value) {
      isAddress1Decrypted.value = true;
    }
    if (!value) {
      address1.value = null;
    }
  },
});

const address2Formatted = computed({
  get: () => {
    if (address2.value) {
      return address2.value;
    }
    if (!address2HasBeenEdited.value && address2Partial.value) {
      return address2Partial.value;
    }
    return '';
  },
  set: (value: string) => {
    address2HasBeenEdited.value = true;
    address2.value = value || null;
    if (value) {
      isAddress2Decrypted.value = true;
    }
    if (!value) {
      address2.value = null;
    }
  },
});

const itemsDocuments = ref([
  { value: EUserDocumentType.CPF, title: t('cpf') },
  { value: EUserDocumentType.CNPJ, title: t('cnpj') },
]);

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
  currentType.value ? docConfig[currentType.value].label : t('document')
);
const docPlaceholder = computed(() =>
  currentType.value ? docConfig[currentType.value].placeholder : t('document')
);

const onlyDigits = (s: string) => s.replaceAll(/\D+/g, '');

const cpfRegex = /^\d{11}$/;
const cnpjRegex = /^\d{14}$/;

const requiredMsg = (label: string) => t('field_required', { field: label });

const docRules = computed(() => {
  if (!documentHasBeenEdited.value) {
    return [];
  }
  return [
    (v: string | null) =>
      (!!v && onlyDigits(v).length > 0) || requiredMsg(docLabel.value),
    (v: string | null) => {
      if (!v) return true;
      const digits = onlyDigits(v);
      if (isCPF.value) return cpfRegex.test(digits) || t('cpf_invalid');
      if (isCNPJ.value) return cnpjRegex.test(digits) || t('cnpj_invalid');
      return true;
    },
  ];
});

const refFormAdditionalInfo = ref<VForm>();

const country_id = ref<number | null>(null);
const zip_code = ref<string | null>(null);
const address1 = ref<string | null>(null);
const address1Partial = ref<string | null>(null);
const isAddress1Decrypted = ref(false);
const isLoadingAddress1 = ref(false);
const address1HasBeenEdited = ref(false);
const address2 = ref<string | null>(null);
const address2Partial = ref<string | null>(null);
const isAddress2Decrypted = ref(false);
const isLoadingAddress2 = ref(false);
const address2HasBeenEdited = ref(false);
const city = ref<string | null>(null);
const state = ref<string | null>(null);
const state_id = ref<string | null>(null);
const city_id = ref<string | null>(null);
const isStateMenuOpen = ref(false);
const isCityMenuOpen = ref(false);
const district = ref<string | null>(null);

const itemsCountry = ref([{ value: ECountry.Brasil, title: t('brazil') }]);

const zipInputRef = ref<HTMLInputElement | null>(null);
const refFormAddress = ref<VForm>();

const openFileSelector = () => {
  const input = globalThis.document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
  };
  input.click();
};

const handleImageSelect = (file: File) => {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    accountSettingsStore.showSnackbar(
      t('profile_status_file_size_exceeded', { max: '16 MB' }),
      EColor.error
    );
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

const setupCropArea = (
  img: HTMLImageElement,
  containerWidth: number,
  containerHeight: number
) => {
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

const startCropDrag = (e: MouseEvent | TouchEvent) => {
  e.preventDefault();
  e.stopPropagation();
  cropArea.value.isDragging = true;
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  const container = cropImageRef.value?.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  cropArea.value.startX = clientX - rect.left - cropArea.value.x;
  cropArea.value.startY = clientY - rect.top - cropArea.value.y;

  globalThis.document.addEventListener('mousemove', onCropDrag);
  globalThis.document.addEventListener('touchmove', onCropDrag);
  globalThis.document.addEventListener('mouseup', endCropDrag);
  globalThis.document.addEventListener('touchend', endCropDrag);
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

  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  const container = cropImageRef.value?.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  cropArea.value.startX = clientX - rect.left;
  cropArea.value.startY = clientY - rect.top;

  globalThis.document.addEventListener('mousemove', onCropResize);
  globalThis.document.addEventListener('touchmove', onCropResize);
  globalThis.document.addEventListener('mouseup', endCropResize);
  globalThis.document.addEventListener('touchend', endCropResize);
};

const onCropDrag = (e: MouseEvent | TouchEvent) => {
  if (!cropArea.value.isDragging || !cropImageRef.value) return;

  e.preventDefault();
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

  const container = cropImageRef.value.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const x = clientX - rect.left - cropArea.value.startX;
  const y = clientY - rect.top - cropArea.value.startY;

  const imgWidth = cropImageRef.value.offsetWidth;
  const imgHeight = cropImageRef.value.offsetHeight;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  const imgLeft = (containerWidth - imgWidth) / 2;
  const imgTop = (containerHeight - imgHeight) / 2;

  const minX = imgLeft;
  const minY = imgTop;
  const maxX = imgLeft + imgWidth - cropArea.value.width;
  const maxY = imgTop + imgHeight - cropArea.value.height;

  cropArea.value.x = Math.max(minX, Math.min(x, maxX));
  cropArea.value.y = Math.max(minY, Math.min(y, maxY));
};

const getEventCoordinates = (
  e: MouseEvent | TouchEvent
): { x: number; y: number } => {
  const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  return { x: clientX, y: clientY };
};

const onCropResize = (e: MouseEvent | TouchEvent) => {
  if (!cropArea.value.isResizing || !cropImageRef.value) return;

  e.preventDefault();
  const { x: clientX, y: clientY } = getEventCoordinates(e);

  const container = cropImageRef.value.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const deltaX = clientX - rect.left - cropArea.value.startX;
  const deltaY = clientY - rect.top - cropArea.value.startY;

  const handle = cropArea.value.resizeHandle!;
  const minSize = 50;

  let newWidth = cropArea.value.initialWidth;
  let newHeight = cropArea.value.initialHeight;
  let newX = cropArea.value.initialX;
  let newY = cropArea.value.initialY;

  if (handle === 'se') {
    newWidth = Math.max(minSize, cropArea.value.initialWidth + deltaX);
    newHeight = newWidth;
  }

  if (handle === 'sw') {
    newWidth = Math.max(minSize, cropArea.value.initialWidth - deltaX);
    newHeight = newWidth;
    newX = cropArea.value.initialX + (cropArea.value.initialWidth - newWidth);
  }

  if (handle === 'ne') {
    newWidth = Math.max(minSize, cropArea.value.initialWidth + deltaX);
    newHeight = newWidth;
    newY = cropArea.value.initialY + (cropArea.value.initialHeight - newHeight);
  }

  if (handle === 'nw') {
    newWidth = Math.max(minSize, cropArea.value.initialWidth - deltaX);
    newHeight = newWidth;
    newX = cropArea.value.initialX + (cropArea.value.initialWidth - newWidth);
    newY = cropArea.value.initialY + (cropArea.value.initialHeight - newHeight);
  }

  const imgWidth = cropImageRef.value.offsetWidth;
  const imgHeight = cropImageRef.value.offsetHeight;
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;

  const imgLeft = (containerWidth - imgWidth) / 2;
  const imgTop = (containerHeight - imgHeight) / 2;

  const maxX = imgLeft + imgWidth - newWidth;
  const maxY = imgTop + imgHeight - newHeight;

  newX = Math.max(imgLeft, Math.min(newX, maxX));
  newY = Math.max(imgTop, Math.min(newY, maxY));

  cropArea.value.width = newWidth;
  cropArea.value.height = newHeight;
  cropArea.value.x = newX;
  cropArea.value.y = newY;
};

const endCropDrag = () => {
  cropArea.value.isDragging = false;
  globalThis.document.removeEventListener('mousemove', onCropDrag);
  globalThis.document.removeEventListener('touchmove', onCropDrag);
  globalThis.document.removeEventListener('mouseup', endCropDrag);
  globalThis.document.removeEventListener('touchend', endCropDrag);
};

const endCropResize = () => {
  cropArea.value.isResizing = false;
  cropArea.value.resizeHandle = null;
  globalThis.document.removeEventListener('mousemove', onCropResize);
  globalThis.document.removeEventListener('touchmove', onCropResize);
  globalThis.document.removeEventListener('mouseup', endCropResize);
  globalThis.document.removeEventListener('touchend', endCropResize);
};

const cropImage = () => {
  if (!cropImageRef.value || !cropCanvasRef.value) return;

  const img = cropImageRef.value;
  const canvas = cropCanvasRef.value;
  const ctx = canvas.getContext('2d');

  if (!ctx || !img.complete) {
    accountSettingsStore.showSnackbar(t('wait_image_load'), EColor.warning);
    return;
  }

  const container = img.parentElement;
  if (!container) return;

  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight;
  const imgLeft = (containerWidth - img.offsetWidth) / 2;
  const imgTop = (containerHeight - img.offsetHeight) / 2;

  const relativeX = cropArea.value.x - imgLeft;
  const relativeY = cropArea.value.y - imgTop;

  const scaleX = img.naturalWidth / img.offsetWidth;
  const scaleY = img.naturalHeight / img.offsetHeight;

  const sourceX = relativeX * scaleX;
  const sourceY = relativeY * scaleY;
  const sourceWidth = cropArea.value.width * scaleX;
  const sourceHeight = cropArea.value.height * scaleY;

  canvas.width = cropPreviewSize;
  canvas.height = cropPreviewSize;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    img,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    cropPreviewSize,
    cropPreviewSize
  );

  canvas.toBlob(
    (blob) => {
      if (!blob) return;

      const croppedFile = new File([blob], 'user-photo.jpg', {
        type: 'image/jpeg',
      });
      photoFile.value = croppedFile;
      cropDialog.value.croppedImage = canvas.toDataURL('image/jpeg');
      isCropModalOpen.value = false;

      uploadPhoto(croppedFile);
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

const uploadPhoto = async (file: File) => {
  isUploadingPhoto.value = true;

  const result = await accountSettingsStore.updatePhoto(file);

  if (result && chatStore.user?.info) {
    chatStore.user.info.photo = result.photo;
    setUser(chatStore.user);
  }

  isUploadingPhoto.value = false;
};

const resetPhoto = () => {
  photoFile.value = null;
  photoPreview.value = null;
  cropDialog.value.croppedImage = '';
};

const saveAdditionalInfo = async () => {
  const validateForm = await refFormAdditionalInfo.value?.validate();
  if (!validateForm?.valid) return;

  const phoneNumber = phone.value?.replaceAll(/\D/g, '');

  const body: UpdateAdditionalInfoRequest = {};

  if (phone_ddi.value) {
    body.phone_ddi = phone_ddi.value;
  }
  if (phoneNumber) {
    body.phone = phoneNumber;
  }
  if (name.value) {
    body.name = name.value;
  }
  if (last_name.value) {
    body.last_name = last_name.value;
  }
  if (birth_date.value) {
    body.birth_date = birth_date.value;
  }
  if (user_document_type_id.value) {
    body.document_type_id = user_document_type_id.value;
  }
  if (document.value) {
    body.document = document.value;
  }

  const result = await accountSettingsStore.updateAdditionalInfo(body);

  if (result && chatStore.user) {
    if (name.value && chatStore.user.info) {
      chatStore.user.info.name = name.value;
    }
    if (last_name.value && chatStore.user.info) {
      chatStore.user.info.last_name = last_name.value;
    }
    setUser(chatStore.user);
  }
};

const clearAddressFields = () => {
  address1.value = '';
  address2.value = '';
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

  if (country_id.value && zip_code.value) {
    await viewZipcode();
  }
};

const onStateChange = async (val: string | null) => {
  state_id.value = val;
  clearCities();

  if (state_id.value) {
    await loadCities(state_id.value);
  }
};

const updateAddressFields = async (response: {
  address_1: string;
  address_2?: string | null;
  city: string;
  state: string;
  district: string;
}) => {
  address1.value = response.address_1;
  address2.value = response.address_2 ?? null;
  district.value = response.district;

  if (country_id.value) {
    await loadStates(country_id.value);

    const stateValue = response.state.trim();
    let stateName = stateValue;
    let stateAbbreviation: string | null = null;

    const lastOpenParen = stateValue.lastIndexOf('(');
    const lastCloseParen = stateValue.lastIndexOf(')');

    if (
      lastOpenParen > 0 &&
      lastCloseParen > lastOpenParen &&
      lastCloseParen === stateValue.length - 1
    ) {
      stateName = stateValue.slice(0, lastOpenParen).trim();
      stateAbbreviation = stateValue
        .slice(lastOpenParen + 1, lastCloseParen)
        .trim();
    }

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
  if (!country_id.value || !zip_code.value) {
    return;
  }

  const params: ViewZipcodeRequest = {
    country_id: country_id.value,
    zipcode: zip_code.value,
  };

  const response = await userStore.viewZipcode(params);
  if (response) {
    await updateAddressFields(response);
  }
};

const saveAddress = async () => {
  const validateForm = await refFormAddress.value?.validate();
  if (!validateForm?.valid) return;

  const selectedState = states.value.find(
    (s) => s.id_zipcode_state === state_id.value
  );
  const selectedCity = cities.value.find(
    (c) => c.id_zipcode_city === city_id.value
  );

  const body: UpdateAddressRequest = {};

  if (country_id.value) {
    body.country_id = country_id.value;
  }
  if (zip_code.value) {
    body.zip_code = zip_code.value;
  }
  if (address1.value) {
    body.address1 = address1.value;
  }
  if (address2.value) {
    body.address2 = address2.value;
  }
  if (selectedCity?.fiscal_code) {
    body.city_fiscal_code = selectedCity.fiscal_code;
  }
  if (selectedState?.fiscal_code) {
    body.state_fiscal_code = selectedState.fiscal_code;
  }
  if (district.value) {
    body.district = district.value;
  }

  await accountSettingsStore.updateAddress(body);
};

const formatBirthDate = (
  dateString: string | null | undefined
): string | null => {
  if (!dateString) return null;

  const dateMatch = dateString.match(/^(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    return dateMatch[1];
  }

  return dateString;
};

const loadUserData = async () => {
  const additionalInfo = await accountSettingsStore.getAdditionalInfo();

  if (additionalInfo) {
    phone_ddi.value = additionalInfo.phone_ddi ?? '55';
    phonePartial.value = additionalInfo.phone_partial ?? null;
    phone.value = null;
    isPhoneDecrypted.value = false;
    phoneHasBeenEdited.value = false;
    name.value = additionalInfo.name ?? null;
    last_name.value = additionalInfo.last_name ?? null;
    birth_date.value = formatBirthDate(additionalInfo.birth_date);
    photoPreview.value = additionalInfo.photo ?? null;
    documentPartial.value = additionalInfo.document_partial ?? null;
    document.value = null;
    isDocumentDecrypted.value = false;
    documentHasBeenEdited.value = false;

    if (additionalInfo.document_type_id === EUserDocumentType.CPF) {
      user_document_type_id.value = EUserDocumentType.CPF;
    }
    if (additionalInfo.document_type_id === EUserDocumentType.CNPJ) {
      user_document_type_id.value = EUserDocumentType.CNPJ;
    }
    if (
      additionalInfo.document_type_id &&
      additionalInfo.document_type_id !== EUserDocumentType.CPF &&
      additionalInfo.document_type_id !== EUserDocumentType.CNPJ
    ) {
      user_document_type_id.value = additionalInfo.document_type_id;
    }
    if (!additionalInfo.document_type_id) {
      user_document_type_id.value = null;
    }
  }

  if (!phone_ddi.value) {
    phone_ddi.value = '55';
  }

  if (chatStore.user?.address) {
    zip_code.value = chatStore.user.address.zip_code ?? null;
    address1Partial.value = chatStore.user.address.address1_partial ?? null;
    address1.value = null;
    isAddress1Decrypted.value = false;
    address1HasBeenEdited.value = false;
    address2Partial.value = chatStore.user.address.address2_partial ?? null;
    address2.value = null;
    isAddress2Decrypted.value = false;
    address2HasBeenEdited.value = false;
    district.value = chatStore.user.address.district ?? null;
    state.value = chatStore.user.address.state ?? null;
    city.value = chatStore.user.address.city ?? null;
  }

  if (!phone_ddi.value) {
    phone_ddi.value = '55';
  }

  if (!country_id.value) {
    country_id.value = ECountry.Brasil;
  }

  const addressData = await accountSettingsStore.getAddressComplete();
  if (addressData) {
    country_id.value = addressData.country_id ?? ECountry.Brasil;
    zip_code.value = addressData.zip_code ?? null;
    address1.value = addressData.address1 ?? null;
    address2.value = addressData.address2 ?? null;
    district.value = addressData.district ?? null;
    state.value = addressData.state ?? null;
    city.value = addressData.city ?? null;
    state_id.value = addressData.state_id ?? null;
    city_id.value = addressData.city_id ?? null;

    if (country_id.value) {
      await loadStates(country_id.value);
    }

    if (state_id.value) {
      await loadCities(state_id.value);
    }
  }
};

onMounted(async () => {
  await loadUserData();
});

let timer: number | null = null;
watch(zip_code, () => {
  if (!country_id.value || !zip_code.value || zip_code.value.length < 8) return;

  if (timer) (globalThis as Window & typeof globalThis).clearTimeout(timer);

  timer = (globalThis as Window & typeof globalThis).setTimeout(() => {
    viewZipcode();
  }, 400);
});
</script>

<template>
  <div class="d-flex flex-column gap-4">
    <VCard variant="outlined">
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('profile_details') }}
      </VCardTitle>
      <VDivider />
      <VCardText>
        <div class="d-flex align-center gap-6 pa-4">
          <div
            class="d-flex align-center justify-center"
            style="min-width: 120px"
          >
            <VAvatar
              size="120"
              class="cursor-pointer"
              @click="openFileSelector"
            >
              <VImg
                v-if="photoPreview || chatStore.user?.info.photo"
                :src="photoPreview || chatStore.user?.info.photo || ''"
              />
              <VImg
                v-if="!photoPreview && !chatStore.user?.info.photo"
                :src="'/images/svg/avatar-default.svg'"
                alt="Avatar"
              />
              <div class="photo-overlay d-flex align-center justify-center">
                <VIcon icon="tabler-camera" size="24" color="white" />
              </div>
            </VAvatar>
          </div>

          <div class="d-flex flex-column gap-3 flex-grow-1">
            <div class="d-flex gap-3">
              <VBtn
                color="primary"
                variant="elevated"
                size="default"
                @click="openFileSelector"
              >
                {{
                  chatStore.user?.info.photo
                    ? $t('change_photo')
                    : $t('upload_new_photo')
                }}
              </VBtn>
              <VBtn
                v-if="chatStore.user?.info.photo || photoPreview"
                color="grey"
                variant="outlined"
                size="default"
                @click="resetPhoto"
              >
                {{ $t('reset') }}
              </VBtn>
            </div>

            <p class="text-body-2 text-medium-emphasis mb-0">
              {{ $t('allowed_jpg_gif_png_max_size_800k') }}
            </p>
          </div>
        </div>
      </VCardText>
    </VCard>

    <VCard variant="outlined">
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('additional_info') }}
      </VCardTitle>
      <VDivider />
      <VCardText>
        <VForm class="mt-4" ref="refFormAdditionalInfo" @submit.prevent>
          <VRow class="mb-2">
            <VCol cols="12" md="6">
              <div>
                <VLabel class="mb-1 text-body-2">{{ $t('phone_ddi') }}:</VLabel>
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
              >
                <template #append-inner>
                  <VIcon
                    v-if="phonePartial"
                    :icon="isPhoneDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
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
                  documentPartial = null;
                  isDocumentDecrypted = false;
                  documentHasBeenEdited = false;
                "
              />
            </VCol>

            <VCol v-if="isCPF || isCNPJ || documentPartial" cols="12" md="6">
              <AppTextField
                v-if="documentHasBeenEdited && (isCPF || isCNPJ)"
                v-model="document"
                :label="docLabel + ':'"
                :placeholder="docPlaceholder"
                v-maska="docMask"
                inputmode="numeric"
                :rules="docRules"
              >
                <template #append-inner>
                  <VIcon
                    v-if="documentPartial"
                    :icon="
                      isDocumentDecrypted ? 'tabler-eye-off' : 'tabler-eye'
                    "
                    class="cursor-pointer"
                    :class="{ 'opacity-50': isLoadingDocument }"
                    @click.stop="toggleDocumentVisibility"
                  />
                </template>
              </AppTextField>
              <AppTextField
                v-else
                v-model="documentFormatted"
                :label="docLabel + ':'"
                :placeholder="docPlaceholder"
                :inputmode="isCPF || isCNPJ ? 'numeric' : 'text'"
                :rules="documentHasBeenEdited ? docRules : []"
                @input="
                  if (!documentHasBeenEdited) {
                    documentHasBeenEdited = true;
                  }
                "
              >
                <template #append-inner>
                  <VIcon
                    v-if="documentPartial"
                    :icon="
                      isDocumentDecrypted ? 'tabler-eye-off' : 'tabler-eye'
                    "
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
            <VBtn
              @click="saveAdditionalInfo"
              :loading="accountSettingsStore.loading"
            >
              {{ $t('save') }}
            </VBtn>
          </VCardText>
        </VForm>
      </VCardText>
    </VCard>

    <VCard variant="outlined">
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('address') }}
      </VCardTitle>
      <VDivider />
      <VCardText>
        <VForm class="mt-4" ref="refFormAddress" @submit.prevent>
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
                :disabled="!country_id"
                @blur="viewZipcode"
                @keydown.enter.prevent="viewZipcode"
                maxlength="8"
              />
            </VCol>
            <VCol cols="12" md="6">
              <div>
                <VLabel class="mb-1 text-body-2">{{ $t('state') }}:</VLabel>
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
                      <template v-if="filteredStates.length > 0">
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
                      </template>
                      <VListItem
                        v-if="filteredStates.length === 0 && stateSearchQuery"
                        disabled
                      >
                        <VListItemTitle
                          class="text-center text-body-2 text-medium-emphasis"
                        >
                          {{ $t('no_results_found') }}
                        </VListItemTitle>
                      </VListItem>
                    </VList>
                  </VCard>
                </VMenu>
              </div>
            </VCol>
            <VCol cols="12" md="6">
              <div>
                <VLabel class="mb-1 text-body-2">{{ $t('city') }}:</VLabel>
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
                      <template v-if="filteredCities.length > 0">
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
                      </template>
                      <VListItem
                        v-if="filteredCities.length === 0 && citySearchQuery"
                        disabled
                      >
                        <VListItemTitle
                          class="text-center text-body-2 text-medium-emphasis"
                        >
                          {{ $t('no_results_found') }}
                        </VListItemTitle>
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
              >
                <template #append-inner>
                  <VIcon
                    v-if="address1Partial"
                    :icon="
                      isAddress1Decrypted ? 'tabler-eye-off' : 'tabler-eye'
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
              >
                <template #append-inner>
                  <VIcon
                    v-if="address2Partial"
                    :icon="
                      isAddress2Decrypted ? 'tabler-eye-off' : 'tabler-eye'
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
            <VBtn @click="saveAddress" :loading="accountSettingsStore.loading">
              {{ $t('save') }}
            </VBtn>
          </VCardText>
        </VForm>
      </VCardText>
    </VCard>

    <VDialog v-model="isCropModalOpen" max-width="500" persistent>
      <VCard>
        <VCardTitle class="d-flex justify-space-between align-center">
          <span>{{ $t('crop_image') }}</span>
          <IconBtn @click="cancelCrop">
            <VIcon icon="tabler-x" />
          </IconBtn>
        </VCardTitle>

        <VCardText>
          <div class="crop-container">
            <img
              ref="cropImageRef"
              :src="cropDialog.imageSrc"
              alt="Crop"
              class="crop-image"
              @mousedown.stop="startCropDrag"
              @touchstart.stop="startCropDrag"
            />
            <div
              class="crop-area"
              :style="{
                left: cropArea.x + 'px',
                top: cropArea.y + 'px',
                width: cropArea.width + 'px',
                height: cropArea.height + 'px',
              }"
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
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>

    <VSnackbar
      v-model="accountSettingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="accountSettingsStore.snackbar.color"
    >
      {{ accountSettingsStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>

<style lang="scss" scoped>
.photo-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  opacity: 0;
  transition: opacity 0.2s;
  border-radius: 50%;
}

.cursor-pointer:hover .photo-overlay {
  opacity: 1;
}

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
</style>
