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
      return formatDocumentForDisplay(document.value);
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
      const maxLength = isCPF.value ? 11 : 14;
      const digits = onlyDigits(value).slice(0, maxLength);
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
    initialAddressValues.value.address1 = null;
    return;
  }

  isLoadingAddress1.value = true;
  const decryptedAddress1 = await accountSettingsStore.getAddress1Decrypted();
  isLoadingAddress1.value = false;

  if (decryptedAddress1) {
    address1.value = decryptedAddress1;
    isAddress1Decrypted.value = true;

    if (!address1HasBeenEdited.value) {
      initialAddressValues.value.address1 = decryptedAddress1;
    }
  }
};

const toggleAddress2Visibility = async () => {
  if (isAddress2Decrypted.value) {
    address2.value = null;
    address2HasBeenEdited.value = false;
    isAddress2Decrypted.value = false;
    initialAddressValues.value.address2 = null;
    return;
  }

  isLoadingAddress2.value = true;
  const decryptedAddress2 = await accountSettingsStore.getAddress2Decrypted();
  isLoadingAddress2.value = false;

  if (decryptedAddress2) {
    address2.value = decryptedAddress2;
    isAddress2Decrypted.value = true;

    if (!address2HasBeenEdited.value) {
      initialAddressValues.value.address2 = decryptedAddress2;
    }
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
const formatCpfDigits = (digits: string) => {
  const clean = digits.slice(0, 11);
  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return `${clean.slice(0, 3)}.${clean.slice(3)}`;
  if (clean.length <= 9) {
    return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6)}`;
  }
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
};
const formatCnpjDigits = (digits: string) => {
  const clean = digits.slice(0, 14);
  if (clean.length <= 2) return clean;
  if (clean.length <= 5) return `${clean.slice(0, 2)}.${clean.slice(2)}`;
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5)}`;
  }
  if (clean.length <= 12) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8)}`;
  }
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12, 14)}`;
};
const formatDocumentForDisplay = (digits: string | null) => {
  if (!digits) return '';
  if (isCPF.value) return formatCpfDigits(digits);
  if (isCNPJ.value) return formatCnpjDigits(digits);
  return digits;
};

const cpfRegex = /^\d{11}$/;
const cnpjRegex = /^\d{14}$/;

const requiredMsg = (label: string) => t('field_required', { field: label });

const docRules = computed(() => {
  if (isCPF.value || isCNPJ.value) {
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
  }
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
const shouldUseDocMask = computed(
  () =>
    (isCPF.value || isCNPJ.value) &&
    (documentHasBeenEdited.value ||
      isDocumentDecrypted.value ||
      !!document.value)
);

const country_id = ref<number | null>(null);
const zip_code = ref<string | null>(null);
const zip_codeFormatted = computed({
  get: () => {
    if (!zip_code.value) return '';
    const digits = zip_code.value.replaceAll(/\D/g, '');
    if (digits.length <= 5) return digits;
    return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
  },
  set: (value: string) => {
    const digits = value.replaceAll(/\D/g, '').slice(0, 8);
    zip_code.value = digits || null;
  },
});
const isViewingZipcode = ref(false);
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
const isInitializing = ref(true);
const city = ref<string | null>(null);
const state = ref<string | null>(null);
const state_id = ref<string | null>(null);
const city_id = ref<string | null>(null);
const district = ref<string | null>(null);

const initialAddressValues = ref<{
  country_id: number | null;
  zip_code: string | null;
  address1: string | null;
  address2: string | null;
  city_fiscal_code: string | null;
  state_fiscal_code: string | null;
  district: string | null;
}>({
  country_id: null,
  zip_code: null,
  address1: null,
  address2: null,
  city_fiscal_code: null,
  state_fiscal_code: null,
  district: null,
});

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
  const { x: clientX } = getEventCoordinates(e);

  const container = cropImageRef.value.parentElement;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  const deltaX = clientX - rect.left - cropArea.value.startX;

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

const deletePhoto = async () => {
  const result = await accountSettingsStore.deletePhoto();

  if (result && chatStore.user?.info) {
    chatStore.user.info.photo = result.photo;
    setUser(chatStore.user);
    photoPreview.value = null;
    photoFile.value = null;
    cropDialog.value.croppedImage = '';
  }
};

const handleDocumentTypeSelect = () => {
  document.value = null;
  documentPartial.value = null;
  isDocumentDecrypted.value = false;
  documentHasBeenEdited.value = true;
};

const handleDocumentTypeClear = () => {
  document.value = null;
  documentPartial.value = null;
  isDocumentDecrypted.value = false;
  documentHasBeenEdited.value = false;
};

const buildAdditionalInfoBody = (): UpdateAdditionalInfoRequest => {
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
  if (user_document_type_id.value !== undefined) {
    if (user_document_type_id.value === null) {
      body.document_type_id = null;
      body.document = null;
    } else {
      body.document_type_id = user_document_type_id.value;
      if (document.value) {
        body.document = document.value;
      }
    }
  } else {
    if (document.value) {
      body.document = document.value;
    }
  }

  return body;
};

const updateChatStoreUserInfo = () => {
  if (!chatStore.user?.info) {
    return;
  }

  if (name.value) {
    chatStore.user.info.name = name.value;
  }
  if (last_name.value) {
    chatStore.user.info.last_name = last_name.value;
  }
  setUser(chatStore.user);
};

const saveAdditionalInfo = async () => {
  const validateForm = await refFormAdditionalInfo.value?.validate();
  if (!validateForm?.valid) {
    return;
  }

  const body = buildAdditionalInfoBody();
  const result = await accountSettingsStore.updateAdditionalInfo(body);

  if (result && chatStore.user) {
    updateChatStoreUserInfo();
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
  zip_code.value = null;
  clearCities();
};

const onCountryChange = async (val: number | null) => {
  country_id.value = val;
  clearAddressFields();

  if (country_id.value) {
    await loadStates(country_id.value);
  }

  const zipCodeDigits = zip_code.value?.replaceAll(/\D/g, '') || '';
  if (country_id.value && zipCodeDigits && zipCodeDigits.length === 8) {
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
  address1HasBeenEdited.value = true;
  isAddress1Decrypted.value = true;
  address2.value = response.address_2 ?? null;
  if (response.address_2) {
    address2HasBeenEdited.value = true;
    isAddress2Decrypted.value = true;
  }
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
  if (isViewingZipcode.value) return;

  const zipCodeDigits = zip_code.value?.replaceAll(/\D/g, '') || '';
  if (!country_id.value || !zipCodeDigits || zipCodeDigits.length !== 8) {
    return;
  }

  isViewingZipcode.value = true;

  try {
    const params: ViewZipcodeRequest = {
      country_id: country_id.value,
      zipcode: zipCodeDigits,
    };

    const response = await userStore.viewZipcode(params);
    if (response) {
      await updateAddressFields(response);
    }
  } finally {
    isViewingZipcode.value = false;
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

  const currentCountryId =
    country_id.value !== null && country_id.value !== undefined
      ? country_id.value
      : null;
  if (currentCountryId !== initialAddressValues.value.country_id) {
    if (currentCountryId === null) {
      body.country_id = null;
    } else {
      body.country_id = currentCountryId;
    }
  }

  const currentZipCode = zip_code.value || null;
  if (currentZipCode !== initialAddressValues.value.zip_code) {
    body.zip_code = currentZipCode;
  }

  if (address1HasBeenEdited.value) {
    body.address1 = address1.value ?? '';
  }

  if (address2HasBeenEdited.value) {
    body.address2 = address2.value ?? '';
  }

  const currentCityFiscalCode = selectedCity?.fiscal_code || null;
  if (currentCityFiscalCode !== initialAddressValues.value.city_fiscal_code) {
    body.city_fiscal_code = currentCityFiscalCode;
  }

  const currentStateFiscalCode = selectedState?.fiscal_code || null;
  if (currentStateFiscalCode !== initialAddressValues.value.state_fiscal_code) {
    body.state_fiscal_code = currentStateFiscalCode;
  }

  const currentDistrictValue = district.value?.trim();
  const currentDistrict =
    currentDistrictValue && currentDistrictValue.length > 0
      ? currentDistrictValue
      : null;
  const initialDistrictValue = initialAddressValues.value.district?.trim();
  const initialDistrict =
    initialDistrictValue && initialDistrictValue.length > 0
      ? initialDistrictValue
      : null;
  if (currentDistrict !== initialDistrict) {
    body.district = currentDistrict;
  }

  if (Object.keys(body).length === 0) {
    return;
  }

  const result = await accountSettingsStore.updateAddress(body);

  if (result) {
    if (body.address1 !== undefined) {
      initialAddressValues.value.address1 = address1.value || null;
      address1HasBeenEdited.value = false;
    }
    if (body.address2 !== undefined) {
      initialAddressValues.value.address2 = address2.value || null;
      address2HasBeenEdited.value = false;
    }
    if (body.zip_code !== undefined) {
      initialAddressValues.value.zip_code = zip_code.value || null;
    }
    if (body.district !== undefined) {
      initialAddressValues.value.district = district.value || null;
    }
    if (body.city_fiscal_code !== undefined) {
      initialAddressValues.value.city_fiscal_code =
        selectedCity?.fiscal_code || null;
    }
    if (body.state_fiscal_code !== undefined) {
      initialAddressValues.value.state_fiscal_code =
        selectedState?.fiscal_code || null;
    }
    if (body.country_id !== undefined) {
      initialAddressValues.value.country_id = country_id.value || null;
    }
  }
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

const loadAdditionalInfo = async () => {
  const additionalInfo = await accountSettingsStore.getAdditionalInfo();

  if (!additionalInfo) {
    return;
  }

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
};

const loadAddressData = async () => {
  const addressData = await accountSettingsStore.getAddressComplete();

  if (!addressData) {
    initialAddressValues.value = {
      country_id: null,
      zip_code: null,
      address1: null,
      address2: null,
      city_fiscal_code: null,
      state_fiscal_code: null,
      district: null,
    };
    return;
  }

  const selectedStateInitial = states.value.find(
    (s) => s.id_zipcode_state === addressData.state_id
  );
  const selectedCityInitial = cities.value.find(
    (c) => c.id_zipcode_city === addressData.city_id
  );

  country_id.value = addressData.country_id ?? ECountry.Brasil;
  zip_code.value = addressData.zip_code ?? null;
  address1Partial.value = addressData.address1_partial ?? null;
  address2Partial.value = addressData.address2_partial ?? null;
  address1.value = null;
  address2.value = null;
  isAddress1Decrypted.value = false;
  isAddress2Decrypted.value = false;
  address1HasBeenEdited.value = false;
  address2HasBeenEdited.value = false;
  district.value = addressData.district ?? null;
  state.value = addressData.state ?? null;
  city.value = addressData.city ?? null;
  state_id.value = addressData.state_id ?? null;
  city_id.value = addressData.city_id ?? null;

  initialAddressValues.value = {
    country_id: addressData.country_id ?? null,
    zip_code: addressData.zip_code ?? null,
    address1: null,
    address2: null,
    city_fiscal_code: selectedCityInitial?.fiscal_code ?? null,
    state_fiscal_code: selectedStateInitial?.fiscal_code ?? null,
    district: addressData.district ?? null,
  };

  if (country_id.value) {
    await loadStates(country_id.value);
  }

  if (state_id.value) {
    await loadCities(state_id.value);
  }

  const selectedState = states.value.find(
    (s) => s.id_zipcode_state === addressData.state_id
  );
  const selectedCity = cities.value.find(
    (c) => c.id_zipcode_city === addressData.city_id
  );

  initialAddressValues.value.city_fiscal_code =
    selectedCity?.fiscal_code ?? null;
  initialAddressValues.value.state_fiscal_code =
    selectedState?.fiscal_code ?? null;
};

const setDefaultValues = () => {
  if (!phone_ddi.value) {
    phone_ddi.value = '55';
  }
  if (!country_id.value) {
    country_id.value = ECountry.Brasil;
  }
};

const loadUserData = async () => {
  await loadAdditionalInfo();
  setDefaultValues();
  await loadAddressData();
  isInitializing.value = false;
};

onMounted(async () => {
  await loadUserData();
});

let timer: number | null = null;
watch(zip_code, () => {
  if (isInitializing.value) return;
  if (isViewingZipcode.value) return;

  const zipCodeDigits = zip_code.value?.replaceAll(/\D/g, '') || '';
  if (!country_id.value || !zipCodeDigits || zipCodeDigits.length !== 8) return;

  if (timer) {
    (globalThis as Window & typeof globalThis).clearTimeout(timer);
    timer = null;
  }

  timer = (globalThis as Window & typeof globalThis).setTimeout(() => {
    viewZipcode();
    timer = null;
  }, 400);
});
</script>

<template>
  <div class="d-flex flex-column account-tab-container">
    <template v-if="isInitializing">
      <VCard variant="elevated" class="account-settings-card">
        <VCardTitle class="text-h6 pa-6 pb-4">
          {{ $t('profile_details') }}
        </VCardTitle>
        <VDivider />
        <VCardText>
          <div class="d-flex align-center gap-6 pa-4">
            <VSkeletonLoader type="avatar" width="120" height="120" />
            <div class="d-flex flex-column gap-3 flex-grow-1">
              <div class="d-flex gap-3">
                <VSkeletonLoader type="button" width="160" height="36" />
                <VSkeletonLoader type="button" width="100" height="36" />
              </div>
              <VSkeletonLoader type="text" width="70%" height="16" />
            </div>
          </div>
        </VCardText>
      </VCard>

      <VCard variant="elevated" class="account-settings-card">
        <VCardTitle class="text-h6 pa-6 pb-4">
          {{ $t('additional_info') }}
        </VCardTitle>
        <VDivider />
        <VCardText>
          <VRow class="mt-4 mb-2">
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="60"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="50"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12">
              <VDivider />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="40"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="80"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="100"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="70"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="80"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
          </VRow>
          <VCardText class="d-flex justify-end flex-wrap gap-3 mt-4 pt-4">
            <VSkeletonLoader type="button" width="100" height="36" />
          </VCardText>
        </VCardText>
      </VCard>

      <VCard variant="elevated" class="account-settings-card">
        <VCardTitle class="text-h6 pa-6 pb-4">
          {{ $t('address') }}
        </VCardTitle>
        <VDivider />
        <VCardText>
          <VRow class="mt-4 mb-2">
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="60"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="80"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="50"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="40"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="70"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="120"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
            <VCol cols="12" md="6">
              <VSkeletonLoader
                type="text"
                width="70"
                height="20"
                class="mb-1"
              />
              <VSkeletonLoader type="text" height="48" />
            </VCol>
          </VRow>
          <VCardText class="d-flex justify-end flex-wrap gap-3 mt-4 pt-4">
            <VSkeletonLoader type="button" width="100" height="36" />
          </VCardText>
        </VCardText>
      </VCard>
    </template>

    <template v-else>
      <VCard variant="elevated" class="account-settings-card">
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
                  color="error"
                  variant="outlined"
                  size="default"
                  @click="deletePhoto"
                  :loading="accountSettingsStore.loading"
                >
                  {{ $t('delete') }}
                </VBtn>
              </div>

              <p class="text-body-2 text-medium-emphasis mb-0">
                {{ $t('allowed_jpg_gif_png_max_size_800k') }}
              </p>
            </div>
          </div>
        </VCardText>
      </VCard>

      <VCard variant="elevated" class="account-settings-card">
        <VCardTitle class="text-h6 pa-6 pb-4">
          {{ $t('additional_info') }}
        </VCardTitle>
        <VDivider />
        <VCardText>
          <VForm class="mt-4" ref="refFormAdditionalInfo" @submit.prevent>
          <VRow class="mb-2">
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('phone_ddi') }}:</VLabel>
              <AppSelectSearch
                v-model="phone_ddi"
                :items="countryCodes"
                :placeholder="$t('select_phone_ddi')"
                item-value="value"
                item-title="title"
              />
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('phone') }}:</VLabel>
              <AppTextField
                v-model="phoneFormatted"
                type="tel"
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
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField v-model="name" :placeholder="$t('name')" />
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('last_name') }}:</VLabel>
              <AppTextField
                v-model="last_name"
                :placeholder="$t('last_name')"
              />
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('document_type') }}:</VLabel
              >
              <AppSelectSearch
                v-model="user_document_type_id"
                :items="itemsDocuments"
                :placeholder="$t('document_type')"
                :clearable="true"
                item-value="value"
                item-title="title"
                @select="handleDocumentTypeSelect"
                @clear="handleDocumentTypeClear"
              />
            </VCol>

            <VCol v-if="isCPF || isCNPJ || documentPartial" cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ docLabel }}:</VLabel>
              <AppTextField
                v-model="documentFormatted"
                :placeholder="docPlaceholder"
                :inputmode="isCPF || isCNPJ ? 'numeric' : 'text'"
                :rules="docRules"
                v-maska="shouldUseDocMask ? docMask : ''"
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
              <VLabel class="text-body-2 mb-1">{{ $t('birth_date') }}:</VLabel>
              <AppDateTimePicker
                v-model="birth_date"
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

    <VCard variant="elevated" class="account-settings-card">
      <VCardTitle class="text-h6 pa-6 pb-4">
        {{ $t('address') }}
      </VCardTitle>
      <VDivider />
      <VCardText>
        <VForm class="mt-4" ref="refFormAddress" @submit.prevent>
          <VRow class="mb-2">
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('country') }}:</VLabel>
              <AppSelectSearch
                :placeholder="$t('country')"
                :model-value="country_id"
                :items="itemsCountry"
                :clearable="true"
                item-value="value"
                item-title="title"
                @update:model-value="
                  (val) => onCountryChange(val as number | null)
                "
                @select="(item) => onCountryChange(item.value as number | null)"
              />
            </VCol>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('zip_code') }}:</VLabel>
              <AppTextField
                ref="zipInputRef"
                v-model="zip_codeFormatted"
                :placeholder="$t('zip_code')"
                :disabled="!country_id"
                :loading="isViewingZipcode"
                v-maska="'#####-###'"
                inputmode="numeric"
                @blur="viewZipcode"
                @keydown.enter.prevent="viewZipcode"
                maxlength="9"
              />
            </VCol>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('state') }}:</VLabel>
              <AppSelectSearch
                v-model="state_id"
                :items="filteredStates"
                :placeholder="$t('state')"
                :disabled="!country_id"
                item-value="value"
                item-title="title"
                @select="
                  (item) => {
                    onStateChange((item.value as string) || null);
                    state = (item.title as string) || null;
                  }
                "
              />
            </VCol>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('city') }}:</VLabel>
              <AppSelectSearch
                v-model="city_id"
                :items="filteredCities"
                :placeholder="$t('city')"
                :disabled="!state_id || !country_id"
                item-value="value"
                item-title="title"
                @select="
                  (item) => {
                    city = (item.title as string) || null;
                  }
                "
              />
            </VCol>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('address') }}:</VLabel>
              <AppTextField
                v-model="address1Formatted"
                :disabled="!country_id"
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
              <VLabel class="text-body-2 mb-1"
                >{{ $t('address_secondary') }}:</VLabel
              >
              <AppTextField
                v-model="address2Formatted"
                :disabled="!country_id"
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
              <VLabel class="text-body-2 mb-1">{{ $t('district') }}:</VLabel>
              <AppTextField
                v-model="district"
                :disabled="!country_id"
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
    </template>

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
            />
            <div
              class="crop-area"
              :style="{
                left: cropArea.x + 'px',
                top: cropArea.y + 'px',
                width: cropArea.width + 'px',
                height: cropArea.height + 'px',
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
  pointer-events: all;
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

.account-tab-container {
  gap: 24px;
}

.account-settings-card {
  background-color: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
  border-radius: 8px;
}
</style>
