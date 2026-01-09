<script lang="ts" setup>
import { useContactStore } from '@/@webcore/stores/contact';
import { useLabelTemplateStore } from '@/@webcore/stores/labelTemplate';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { requiredValidator } from '@/@webcore/utils/validators';
import { EColor } from '@core/common/enums/EColor';
import { useChatStore } from '@/@webcore/stores/chat';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { ELabelTemplatePermissions } from '@core/common/enums/EPermissions/labelTemplate';
import { can } from '@layouts/plugins/casl';
import { EContactDocumentType } from '@core/common/enums/EContactDocumentType';
import { EContactIgnore } from '@core/common/enums/EContactIgnore';
import { validateCpf } from '@core/common/functions/validateCpf';
import { validateCnpj } from '@core/common/functions/validateCnpj';

const contactStore = useContactStore();
const labelTemplateStore = useLabelTemplateStore();
const chatStore = useChatStore();
const { items: countryCodes } = useCountryCodes();
const labelTemplates = ref<
  Array<{ label_template_id: string; label: string; color?: string }>
>([]);
const users = ref<
  Array<{ user_id: string; name: string; photo?: string | null }>
>([]);
const isLoadingUsers = ref(false);

const { t } = useI18n();

type FieldValue = string | { value: string } | null;

const props = defineProps<{
  modelValue: boolean;
  initialData?: Partial<CreateContactRequest> | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const phone_ddi = ref<string | null>('55');

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

const itemsDocumentTypes = ref([
  { value: null, title: t('select_option') },
  { value: EContactDocumentType.cpf, title: t('cpf') },
  { value: EContactDocumentType.cnpj, title: t('cnpj') },
]);

const isCPF = computed(
  () => contact_document_type_id.value === EContactDocumentType.cpf
);
const isCNPJ = computed(
  () => contact_document_type_id.value === EContactDocumentType.cnpj
);
const showDocumentField = computed(() => isCPF.value || isCNPJ.value);

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

const currentDocType = computed<'cpf' | 'cnpj' | null>(
  () => (isCPF.value && 'cpf') || (isCNPJ.value && 'cnpj') || null
);

const docMask = computed(() =>
  currentDocType.value ? docConfig[currentDocType.value].mask : ''
);
const docLabel = computed(() =>
  currentDocType.value ? docConfig[currentDocType.value].label : t('document')
);
const docPlaceholder = computed(() =>
  currentDocType.value
    ? docConfig[currentDocType.value].placeholder
    : t('document')
);

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
  if (clean.length <= 5) {
    return `${clean.slice(0, 2)}.${clean.slice(2)}`;
  }
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5)}`;
  }
  if (clean.length <= 12) {
    return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8)}`;
  }
  return `${clean.slice(0, 2)}.${clean.slice(2, 5)}.${clean.slice(5, 8)}/${clean.slice(8, 12)}-${clean.slice(12, 14)}`;
};

const documentFormatted = computed({
  get: () => {
    if (!document.value) return '';
    const digits = document.value.replaceAll(/\D/g, '');
    if (isCPF.value) return formatCpfDigits(digits);
    if (isCNPJ.value) return formatCnpjDigits(digits);
    return document.value;
  },
  set: (value: string) => {
    document.value = value.replaceAll(/\D/g, '');
  },
});

const documentValidator = (v: string | null | undefined) => {
  if (!showDocumentField.value) return true;
  const s = (v ?? '').trim();
  if (!s) return t('document_required');
  const digits = s.replaceAll(/\D/g, '');
  if (isCPF.value) {
    if (digits.length !== 11) {
      return t('cpf_invalid');
    }
    if (!validateCpf(digits)) {
      return t('cpf_invalid');
    }
  }
  if (isCNPJ.value) {
    if (digits.length !== 14) {
      return t('cnpj_invalid');
    }
    if (!validateCnpj(digits)) {
      return t('cnpj_invalid');
    }
  }
  return true;
};

const canAccessLabelTemplate = computed(() => {
  const permissions = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    ELabelTemplatePermissions.label_template_group,
    ELabelTemplatePermissions.label_view,
  ];
  return can(permissions);
});

const itemsLabel = computed(() =>
  labelTemplates.value.map((item) => ({
    value: item.label_template_id,
    title: item.label,
    color: item.color,
  }))
);

const label_template_id = ref<string | null>(null);
const name = ref<string | null>(null);
const last_name = ref<string | null>(null);
const email = ref<string | null>(null);
const phone = ref<string | null>(null);
const nickname = ref<string | null>(null);
const birthday = ref<string | null>(null);
const notes = ref<string | null>(null);
const contact_document_type_id = ref<string | null>(null);
const document = ref<string | null>(null);
const user_id = ref<string | null>(null);
const ignore = ref<string | null>(EContactIgnore.not_ignore);

watch(contact_document_type_id, () => {
  if (!showDocumentField.value) {
    document.value = null;
  }
});

const photoFile = ref<File | null>(null);
const photoPreview = ref<string | null>(null);
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

const refFormAddContact = ref<VForm>();

const addContact = async () => {
  const validateForm = await refFormAddContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value) return;

  if (!phone_ddi.value) return;

  const phoneNumber = phone.value ? phone.value.replaceAll(/\D/g, '') : null;
  if (!phoneNumber) return;

  const imageUrl =
    photoPreview.value && !photoPreview.value.startsWith('data:')
      ? photoPreview.value
      : null;

  const result = await contactStore.addContact(
    {
      label_template_id: label_template_id.value ?? null,
      name: name.value,
      last_name: last_name.value ?? null,
      email: email.value ?? null,
      phone_ddi: phone_ddi.value,
      phone: phoneNumber,
      nickname: nickname.value ?? null,
      birthday: birthday.value ?? null,
      notes: notes.value ?? null,
      contact_document_type_id: contact_document_type_id.value ?? null,
      document: document.value ?? null,
      image_url: imageUrl,
      user_id: user_id.value ? { value: user_id.value } : undefined,
      ignore: { value: ignore.value ?? EContactIgnore.not_ignore },
    },
    imageUrl ? null : photoFile.value
  );

  if (result) {
    isVisible.value = false;

    await contactStore.listContact();
  }
};

const extractFieldValue = (field: FieldValue | undefined): string | null => {
  if (field === null || field === undefined) {
    return null;
  }

  if (typeof field === 'object' && 'value' in field) {
    return field.value ?? null;
  }

  if (typeof field === 'string') {
    return field;
  }

  return null;
};

const resetForm = () => {
  if (props.initialData) {
    label_template_id.value = extractFieldValue(
      props.initialData.label_template_id as FieldValue
    );
    name.value = extractFieldValue(props.initialData.name as FieldValue);
    last_name.value = extractFieldValue(
      props.initialData.last_name as FieldValue
    );
    email.value = extractFieldValue(props.initialData.email as FieldValue);
    phone_ddi.value =
      extractFieldValue(props.initialData.phone_ddi as FieldValue) ?? '55';
    phone.value = extractFieldValue(props.initialData.phone as FieldValue);
    nickname.value = extractFieldValue(
      props.initialData.nickname as FieldValue
    );
    birthday.value = extractFieldValue(
      props.initialData.birthday as FieldValue
    );
    notes.value = extractFieldValue(props.initialData.notes as FieldValue);
    contact_document_type_id.value = extractFieldValue(
      props.initialData.contact_document_type_id as FieldValue
    );
    document.value = extractFieldValue(
      props.initialData.document as FieldValue
    );
    user_id.value = extractFieldValue(props.initialData.user_id as FieldValue);
    ignore.value =
      (extractFieldValue(
        props.initialData.ignore as FieldValue
      ) as EContactIgnore) ?? EContactIgnore.not_ignore;
  } else {
    label_template_id.value = null;
    name.value = null;
    last_name.value = null;
    email.value = null;
    phone_ddi.value = '55';
    phone.value = null;
    nickname.value = null;
    birthday.value = null;
    notes.value = null;
    contact_document_type_id.value = null;
    document.value = null;
    user_id.value = null;
    ignore.value = EContactIgnore.not_ignore;
  }
  photoFile.value = null;
  photoPreview.value = null;
  cropDialog.value.imageSrc = '';
  cropDialog.value.croppedImage = '';
  refFormAddContact.value?.resetValidation();
};

const loadUsers = async () => {
  if (isLoadingUsers.value) return;
  isLoadingUsers.value = true;
  const usersList = await contactStore.listContactUsers();
  if (usersList) {
    users.value = usersList.map((u) => ({
      user_id: u.user_id,
      name: u.name || u.user_id,
      photo: u.photo,
    }));
  }
  isLoadingUsers.value = false;
};

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
    chatStore.showSnackbar(
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
  minWidth: number,
  dimensions: { width: number; height: number; x: number; y: number }
): { width: number; height: number; x: number; y: number } => {
  const aspectRatio = cropArea.value.aspectRatio;
  const minHeight = minWidth / aspectRatio;

  if (dimensions.width < minWidth) {
    dimensions.width = minWidth;
    dimensions.height = minHeight;
  }
  if (dimensions.height < minHeight) {
    dimensions.height = minHeight;
    dimensions.width = minWidth;
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
  const aspectRatio = cropArea.value.aspectRatio;

  if (dimensions.width > constraints.maxWidth) {
    dimensions.width = constraints.maxWidth;
    dimensions.height = dimensions.width / aspectRatio;
  }
  if (dimensions.height > constraints.maxHeight) {
    dimensions.height = constraints.maxHeight;
    dimensions.width = dimensions.height * aspectRatio;
  }

  if (dimensions.width > constraints.maxWidth) {
    dimensions.width = constraints.maxWidth;
    dimensions.height = dimensions.width / aspectRatio;
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

const onCropResize = (e: MouseEvent | TouchEvent) => {
  if (
    !cropArea.value.isResizing ||
    !cropImageRef.value ||
    !cropArea.value.resizeHandle
  )
    return;

  e.preventDefault();

  const container = cropImageRef.value.parentElement;
  if (!container) return;

  const { x: clientX, y: clientY } = getEventCoordinates(e);
  const rect = container.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;

  const handle = cropArea.value.resizeHandle;
  const { x: fixedX, y: fixedY } = getFixedPoint(
    handle,
    cropArea.value.initialX,
    cropArea.value.initialY,
    cropArea.value.initialWidth,
    cropArea.value.initialHeight
  );

  const deltaX = mouseX - fixedX;
  const deltaY = mouseY - fixedY;

  const maxDelta = Math.max(Math.abs(deltaX), Math.abs(deltaY));
  let newWidth = maxDelta;
  let newHeight = maxDelta;

  const { x: initialX, y: initialY } = calculateInitialPosition(
    handle,
    fixedX,
    fixedY,
    newWidth
  );

  const imgWidth = cropImageRef.value.offsetWidth;
  const imgHeight = cropImageRef.value.offsetHeight;
  const resizeContainer = cropImageRef.value.parentElement;
  if (!resizeContainer) return;

  const resizeContainerWidth = resizeContainer.clientWidth;
  const resizeContainerHeight = resizeContainer.clientHeight;
  const imgLeft = (resizeContainerWidth - imgWidth) / 2;
  const imgTop = (resizeContainerHeight - imgHeight) / 2;

  const maxWidth = imgLeft + imgWidth;
  const maxHeight = imgTop + imgHeight;
  const minSize = 50;

  const minWidth = minSize;

  const fixedPoint = { x: fixedX, y: fixedY };
  let dimensions = applyMinSizeConstraint(handle, fixedPoint, minWidth, {
    width: newWidth,
    height: newHeight,
    x: initialX,
    y: initialY,
  });

  const currentSize = Math.min(dimensions.width, dimensions.height);
  dimensions.width = currentSize;
  dimensions.height = currentSize;

  const pos1 = calculateInitialPosition(
    handle,
    fixedPoint.x,
    fixedPoint.y,
    dimensions.width
  );
  dimensions.x = pos1.x;
  dimensions.y = pos1.y;

  dimensions = applyMaxSizeConstraint(
    handle,
    fixedPoint,
    { maxWidth, maxHeight },
    dimensions
  );

  const maxSize = Math.min(dimensions.width, dimensions.height);
  dimensions.width = maxSize;
  dimensions.height = maxSize;

  const pos2 = calculateInitialPosition(
    handle,
    fixedPoint.x,
    fixedPoint.y,
    dimensions.width
  );
  dimensions.x = pos2.x;
  dimensions.y = pos2.y;

  const finalImgWidth = cropImageRef.value.offsetWidth;
  const finalImgHeight = cropImageRef.value.offsetHeight;
  const finalContainer = cropImageRef.value.parentElement;
  if (!finalContainer) return;

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

  cropArea.value.width = dimensions.width;
  cropArea.value.height = dimensions.height;
  cropArea.value.x = finalPosition.x;
  cropArea.value.y = finalPosition.y;
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
    chatStore.showSnackbar(t('wait_image_load'), EColor.warning);
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

  const outputWidth = cropPreviewSize;
  const outputHeight = cropPreviewSize;

  canvas.width = outputWidth;
  canvas.height = outputHeight;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.drawImage(
    img,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputWidth,
    outputHeight
  );

  canvas.toBlob(
    (blob) => {
      if (!blob) return;

      const croppedFile = new File([blob], 'temp.jpg', {
        type: 'image/jpeg',
      });
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
  photoPreview.value = null;
};

const loadLabelTemplates = async () => {
  let templates: Array<{
    label_template_id: string;
    label: string;
    color?: string;
  }> | null = null;

  if (canAccessLabelTemplate.value) {
    templates = await labelTemplateStore.listLabelTemplateAll();
  }

  if (!templates || templates.length === 0) {
    templates = await chatStore.listChatLabelTemplates();
  }

  labelTemplates.value =
    templates?.map((lt) => ({
      label_template_id: lt.label_template_id,
      label: lt.label,
      color: lt.color || 'rgb(var(--v-theme-primary))',
    })) ?? [];
};

onMounted(async () => {
  resetForm();
  await loadLabelTemplates();
  await loadUsers();
});

watch(isVisible, (visible) => {
  if (visible) {
    resetForm();
    loadLabelTemplates();
    loadUsers();
  }
});

watch(
  () => props.initialData,
  () => {
    if (isVisible.value && props.initialData) {
      resetForm();
    }
  },
  { deep: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="contactStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddContact" @submit.prevent>
      <VCard :title="$t('add_contact')">
        <VCardText>
          <VRow>
            <VCol cols="12" class="d-flex justify-center">
              <div
                class="photo-container position-relative"
                @mouseenter="
                  (e) => (e.currentTarget as HTMLElement).classList.add('hover')
                "
                @mouseleave="
                  (e) =>
                    (e.currentTarget as HTMLElement).classList.remove('hover')
                "
                @click="openFileSelector"
              >
                <VAvatar size="120" class="cursor-pointer">
                  <VImg
                    v-if="photoPreview"
                    :src="photoPreview"
                    alt="Foto de perfil"
                  />
                  <VImg
                    v-else
                    :src="'/images/svg/avatar-default.svg'"
                    alt="Avatar"
                  />
                </VAvatar>
                <div class="photo-overlay">
                  <VIcon icon="tabler-camera" size="32" class="d-flex" />
                </div>
              </div>
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('last_name') }}:</VLabel>
              <AppTextField
                v-model="last_name"
                :placeholder="$t('last_name')"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('nickname') }}:</VLabel>
              <AppTextField v-model="nickname" :placeholder="$t('nickname')" />
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('email') }}:</VLabel>
              <AppTextField
                v-model="email"
                type="email"
                :placeholder="$t('email')"
                :rules="[emailValidator]"
              />
            </VCol>
          </VRow>
          <VRow>
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
                :rules="[requiredValidator(phone, $t('phone_required'))]"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('birthday') }}:</VLabel>
              <AppDateTimePicker
                v-model="birthday"
                :placeholder="$t('birthday')"
              />
            </VCol>

            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('label') }}:</VLabel>
              <AppSelectSearch
                v-model="label_template_id"
                :items="itemsLabel"
                :placeholder="$t('select_label')"
                :clearable="true"
                item-value="value"
                item-title="title"
                class="label-select"
              >
                <template #prepend-inner="{ item }">
                  <div
                    v-if="item && !Array.isArray(item) && item.color"
                    class="label-color-circle me-2"
                    :style="{ backgroundColor: item.color }"
                  />
                </template>
                <template #item-prepend="{ item }">
                  <div
                    v-if="item && item.color"
                    class="label-color-circle"
                    :style="{ backgroundColor: item.color }"
                  />
                </template>
              </AppSelectSearch>
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('document_type') }}:</VLabel
              >
              <AppSelectSearch
                v-model="contact_document_type_id"
                :items="itemsDocumentTypes"
                :placeholder="$t('document_type')"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>

            <VCol v-if="showDocumentField" cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ docLabel }}:</VLabel>
              <AppTextField
                v-model="documentFormatted"
                :placeholder="docPlaceholder"
                :rules="[documentValidator]"
                :maxlength="currentDocType === 'cpf' ? 14 : 18"
                v-maska="docMask"
                inputmode="numeric"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1"
                >{{ $t('responsible_attendant') }}:</VLabel
              >
              <AppSelectSearch
                v-model="user_id"
                :items="
                  users.map((u) => ({
                    value: u.user_id,
                    title: u.name,
                  }))
                "
                :placeholder="$t('select_responsible_attendant')"
                :loading="isLoadingUsers"
                :clearable="true"
                item-value="value"
                item-title="title"
              />
            </VCol>
            <VCol cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('ignore') }}:</VLabel>
              <AppSelectSearch
                v-model="ignore"
                :items="[
                  { value: EContactIgnore.not_ignore, title: $t('not_ignore') },
                  {
                    value: EContactIgnore.ignore_automation,
                    title: $t('ignore_automation'),
                  },
                  {
                    value: EContactIgnore.ignore_totally,
                    title: $t('ignore_totally'),
                  },
                ]"
                :placeholder="$t('ignore')"
                item-value="value"
                item-title="title"
              />
            </VCol>
          </VRow>
          <VRow>
            <VCol cols="12">
              <label class="text-body-2 mb-1" for="notes-textarea">
                {{ $t('notes') }}:
              </label>
              <VTextarea v-model="notes" :placeholder="$t('notes')" />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addContact"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>

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
          <VBtn @click="cropImage"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VDialog>
  </VDialog>
</template>

<style lang="scss" scoped>
.photo-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  .photo-overlay {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 50%;
    opacity: 0;
    transition: opacity 0.2s;
    color: white;
    pointer-events: none;
    gap: 0.5rem;
  }

  &.hover .photo-overlay {
    opacity: 1;
  }
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
