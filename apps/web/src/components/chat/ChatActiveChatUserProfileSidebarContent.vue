<script lang="ts" setup>
import { nextTick, computed, watch } from 'vue';
import { PerfectScrollbar } from 'vue3-perfect-scrollbar';
import { useChatStore } from '@/@webcore/stores/chat';
import { VForm } from 'vuetify/components/VForm';
import { CreateContactRequest } from '@core/schema/contact/createContact/request.schema';
import {
  EditContactParamsRequest,
  UpdateContactRequest,
} from '@core/schema/contact/editContact/request.schema';
import { useCountryCodes } from '@/composables/useCountryCodes';
import { requiredValidator } from '@/@webcore/utils/validators';
import { extractPhoneAndDdi } from '@core/common/functions/extractPhoneAndDdi';
import { EColor } from '@core/common/enums/EColor';

const chatStore = useChatStore();
const { items: countryCodes } = useCountryCodes();
const labelTemplates = ref<
  Array<{ label_template_id: string; label: string; color?: string }>
>([]);

const { t } = useI18n();

const props = defineProps<{
  isOpen?: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const isContact = computed(() => !!chatStore.activeChat?.contact?.id);
const contactId = computed(() => chatStore.activeChat?.contact?.id ?? null);

const phone_ddi = ref<string | null>('55');
const phone = ref<string | null>(null);
const phonePartialOriginal = ref<string | null>(null);
const emailPartialOriginal = ref<string | null>(null);
const isPhoneDecrypted = ref(false);
const isLoadingPhone = ref(false);
const isEmailDecrypted = ref(false);
const isLoadingEmail = ref(false);

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
  get: () => {
    if (isContact.value && isPhoneDecrypted.value && phone.value) {
      return formatPhone(phone.value);
    }
    if (isContact.value && phone.value) {
      return formatPhone(phone.value);
    }
    if (isContact.value) {
      return phonePartialOriginal.value ?? '';
    }
    return formatPhone(phone.value);
  },
  set: (value: string) => {
    if (isContact.value && isPhoneDecrypted.value) {
      phone.value = value.replaceAll(/\D/g, '');
      return;
    }
    if (isContact.value) {
      const numbers = value.replaceAll(/\D/g, '');
      phone.value = numbers;
      phonePartialOriginal.value = value;
      return;
    }
    phone.value = value.replaceAll(/\D/g, '');
  },
});

const emailFormatted = computed({
  get: () => {
    if (isContact.value && isEmailDecrypted.value) {
      return email.value ?? '';
    }
    if (isContact.value) {
      return emailPartialOriginal.value ?? '';
    }
    return email.value ?? '';
  },
  set: (value: string) => {
    if (isContact.value && isEmailDecrypted.value) {
      email.value = value;
      return;
    }
    if (isContact.value) {
      emailPartialOriginal.value = value;
      email.value = value;
      return;
    }
    email.value = value;
  },
});

const emailValidator = (v: string | null | undefined) => {
  const s = (v ?? '').trim();
  if (!s) return true;
  const re = /^[^\s@]+@(?:[^\s@.]+\.)+[^\s@.]{2,}$/;
  return re.test(s) || t('email_invalid');
};

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
const nickname = ref<string | null>(null);
const birthday = ref<string | null>(null);
const notes = ref<string | null>(null);
const isValided = ref<boolean>(false);

const refFormContact = ref<VForm>();

const togglePhoneVisibility = async () => {
  if (!contactId.value) return;

  if (isPhoneDecrypted.value) {
    if (phonePartialOriginal.value?.includes('*')) {
      phone.value = null;
    }
    if (!phonePartialOriginal.value?.includes('*')) {
      phone.value = phonePartialOriginal.value?.replaceAll(/\D/g, '') ?? null;
    }
    isPhoneDecrypted.value = false;
    return;
  }

  isLoadingPhone.value = true;
  const decryptedPhone = await chatStore.getChatContactPhoneDecrypted(
    contactId.value
  );
  isLoadingPhone.value = false;

  if (decryptedPhone) {
    phone.value = decryptedPhone.replaceAll(/\D/g, '');
    isPhoneDecrypted.value = true;
  }
};

const toggleEmailVisibility = async () => {
  if (!contactId.value) return;

  if (isEmailDecrypted.value) {
    email.value = emailPartialOriginal.value;
    isEmailDecrypted.value = false;
    return;
  }

  isLoadingEmail.value = true;
  const decryptedEmail = await chatStore.getChatContactEmailDecrypted(
    contactId.value
  );
  isLoadingEmail.value = false;

  if (decryptedEmail) {
    email.value = decryptedEmail;
    isEmailDecrypted.value = true;
  }
};

const determineEmailToSave = (): string | null | undefined => {
  const emailValue = email.value?.trim() || '';
  const emailPartialOriginalTrimmed = emailPartialOriginal.value?.trim() || '';

  if (isEmailDecrypted.value) {
    return emailValue || null;
  }

  if (
    !isEmailDecrypted.value &&
    emailValue &&
    emailValue !== emailPartialOriginalTrimmed
  ) {
    return emailValue;
  }

  if (!emailValue && emailPartialOriginalTrimmed) {
    return null;
  }

  if (
    !isEmailDecrypted.value &&
    emailValue &&
    !emailPartialOriginalTrimmed.includes('*')
  ) {
    return emailValue;
  }

  return undefined;
};

const determinePhoneToSave = (): string | null | undefined => {
  const phoneValue = phone.value ? phone.value.replaceAll(/\D/g, '') : '';
  const phonePartialOriginalNumbers = phonePartialOriginal.value
    ? phonePartialOriginal.value.replaceAll(/\D/g, '')
    : '';

  if (isPhoneDecrypted.value && phoneValue) {
    return phoneValue;
  }

  if (
    !isPhoneDecrypted.value &&
    phoneValue &&
    !phonePartialOriginal.value?.includes('*') &&
    phoneValue !== phonePartialOriginalNumbers
  ) {
    return phoneValue;
  }

  return undefined;
};

const loadContactData = async () => {
  if (!contactId.value) return;

  const contact = await chatStore.getChatContactById(contactId.value);
  if (contact) {
    label_template_id.value = contact.label_template?.label_template_id ?? null;
    name.value = contact.name;
    last_name.value = contact.last_name ?? null;

    const emailPartial = contact.email_partial ?? '';
    emailPartialOriginal.value = emailPartial;
    email.value = emailPartial;
    isEmailDecrypted.value = false;

    phone_ddi.value = contact.phone_ddi ?? '55';

    const phonePartial = contact.phone_partial ?? '';
    phonePartialOriginal.value = phonePartial;
    if (phonePartial.includes('*')) {
      phone.value = null;
    }

    if (!phonePartial.includes('*')) {
      phone.value = phonePartial.replaceAll(/\D/g, '');
    }

    isPhoneDecrypted.value = false;

    nickname.value = contact.nickname ?? null;
    birthday.value = contact.birthday ?? null;
    notes.value = contact.notes ?? null;
    isValided.value = contact.is_valided ?? false;
  }
};

const resetFormFields = () => {
  name.value = null;
  last_name.value = null;
  phone.value = null;
  phone_ddi.value = '55';
  email.value = null;
  nickname.value = null;
  birthday.value = null;
  notes.value = null;
  label_template_id.value = null;
};

const processPhoneFromContact = (
  contactPhone: string,
  contactPhoneDdi?: string | null
) => {
  const phoneStr = contactPhoneDdi
    ? `+${contactPhoneDdi} ${contactPhone}`
    : contactPhone;
  return extractPhoneAndDdi(phoneStr);
};

const processPhoneFromChat = (chatPhone: string) => {
  const phoneStr = chatPhone.startsWith('+') ? chatPhone : `+${chatPhone}`;
  return extractPhoneAndDdi(phoneStr);
};

const applyPhoneData = (phoneAndDdi: ReturnType<typeof extractPhoneAndDdi>) => {
  if (!phoneAndDdi) return;

  phone.value = phoneAndDdi.phone;
  if (phoneAndDdi.phone_ddi) {
    phone_ddi.value = phoneAndDdi.phone_ddi;
  }
};

const loadChatData = () => {
  if (!chatStore.activeChat) return;

  const activeChat = chatStore.activeChat;

  if (isContact.value && contactId.value) {
    void loadContactData();
    return;
  }

  resetFormFields();
  name.value = activeChat.contact?.name ?? activeChat.name ?? null;

  if (activeChat.contact?.phone) {
    const phoneAndDdi = processPhoneFromContact(
      activeChat.contact.phone,
      activeChat.contact.phone_ddi
    );
    applyPhoneData(phoneAndDdi);
    return;
  }

  if (activeChat.phone) {
    const phoneAndDdi = processPhoneFromChat(activeChat.phone);
    applyPhoneData(phoneAndDdi);
  }
};

const addContact = async () => {
  const validateForm = await refFormContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value) return;

  const phoneNumber = phone.value ? phone.value.replaceAll(/\D/g, '') : '';
  const phoneDdi = phone_ddi.value ?? '55';

  const imageUrl = photoFile.value
    ? null
    : (chatStore.activeChat?.contact?.photo ??
      chatStore.activeChat?.photo ??
      null);

  const payload: CreateContactRequest = {
    label_template_id: label_template_id.value ?? null,
    name: name.value,
    last_name: last_name.value ?? null,
    email: email.value ?? null,
    phone_ddi: phoneDdi,
    phone: phoneNumber,
    nickname: nickname.value ?? null,
    birthday: birthday.value ?? null,
    notes: notes.value ?? null,
    image_url: imageUrl,
    chat_id: chatStore.activeChat?.chat_id ?? undefined,
  };

  const result = await chatStore.createChatContact(payload, photoFile.value);

  if (result) {
    await nextTick();
    emit('close');
  }
};

const updateContact = async () => {
  const validateForm = await refFormContact?.value?.validate();
  if (!validateForm?.valid) return;

  if (!contactId.value) {
    return;
  }

  const payload: EditContactParamsRequest = {
    contact_id: contactId.value,
  };

  const emailToSave = determineEmailToSave();
  const phoneToSave = determinePhoneToSave();

  const imageUrl = photoFile.value
    ? null
    : (chatStore.activeChat?.contact?.photo ??
      chatStore.activeChat?.photo ??
      null);

  const body: UpdateContactRequest = {
    label_template_id: label_template_id.value,
    name: name.value,
    last_name: last_name.value,
    email: emailToSave,
    phone_ddi: phone_ddi.value,
    phone: phoneToSave,
    nickname: nickname.value,
    birthday: birthday.value,
    notes: notes.value,
    image_url: imageUrl,
    chat_id: chatStore.activeChat?.chat_id ?? undefined,
  };

  const result = await chatStore.updateChatContact(
    payload,
    body,
    photoFile.value
  );

  if (result) {
    await nextTick();
    emit('close');
  }
};

const saveContact = async () => {
  if (isContact.value) {
    await updateContact();
  } else {
    await addContact();
  }
};

watch(
  () => chatStore.activeChat,
  () => {
    loadChatData();
  },
  { immediate: true, deep: true }
);

const openFileSelector = () => {
  const input = document.createElement('input');
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

  document.addEventListener('mousemove', onCropDrag);
  document.addEventListener('touchmove', onCropDrag);
  document.addEventListener('mouseup', endCropDrag);
  document.addEventListener('touchend', endCropDrag);
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

  document.addEventListener('mousemove', onCropResize);
  document.addEventListener('touchmove', onCropResize);
  document.addEventListener('mouseup', endCropResize);
  document.addEventListener('touchend', endCropResize);
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
  document.removeEventListener('mousemove', onCropDrag);
  document.removeEventListener('touchmove', onCropDrag);
  document.removeEventListener('mouseup', endCropDrag);
  document.removeEventListener('touchend', endCropDrag);
};

const endCropResize = () => {
  cropArea.value.isResizing = false;
  cropArea.value.resizeHandle = null;
  document.removeEventListener('mousemove', onCropResize);
  document.removeEventListener('touchmove', onCropResize);
  document.removeEventListener('mouseup', endCropResize);
  document.removeEventListener('touchend', endCropResize);
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
  if (labelTemplates.value.length === 0) {
    const templates = await chatStore.listChatLabelTemplates();
    labelTemplates.value = templates.map((lt) => ({
      label_template_id: lt.label_template_id,
      label: lt.label,
      color: lt.color,
    }));
  }
};

watch(
  () => props.isOpen,
  async (isOpen) => {
    if (isOpen) {
      await loadLabelTemplates();
      loadChatData();
    }
  }
);

onMounted(() => {
  if (props.isOpen) {
    loadLabelTemplates();
    loadChatData();
  }
});
</script>

<template>
  <div v-if="chatStore.activeChat" class="d-flex flex-column h-100">
    <div
      class="pt-6 px-6 d-flex align-center justify-space-between flex-shrink-0"
      :class="$vuetify.locale.isRtl ? 'text-left' : 'text-right'"
    >
      <VChip
        v-if="isContact"
        :color="isValided ? 'success' : 'error'"
        size="small"
      >
        {{ isValided ? $t('validated') : $t('not_validated') }}
      </VChip>
      <div v-else />
      <IconBtn @click="$emit('close')">
        <VIcon icon="tabler-x" class="text-medium-emphasis" />
      </IconBtn>
    </div>

    <!-- User Avatar -->
    <div class="text-center px-6 pb-4 flex-shrink-0">
      <div
        class="photo-container position-relative"
        @mouseenter="
          (e) => (e.currentTarget as HTMLElement).classList.add('hover')
        "
        @mouseleave="
          (e) => (e.currentTarget as HTMLElement).classList.remove('hover')
        "
        @click="openFileSelector"
      >
        <VAvatar
          size="120"
          class="cursor-pointer"
          :variant="
            !(
              photoPreview ??
              chatStore.activeChat.contact?.photo ??
              chatStore.activeChat.photo
            )
              ? 'tonal'
              : undefined
          "
        >
          <VImg v-if="photoPreview" :src="photoPreview" alt="Foto de perfil" />
          <VImg
            v-else-if="
              chatStore.activeChat.contact?.photo ?? chatStore.activeChat.photo
            "
            :src="
              chatStore.activeChat.contact?.photo ??
              chatStore.activeChat.photo ??
              ''
            "
            :alt="
              chatStore.activeChat.contact?.name ??
              chatStore.activeChat.name ??
              ''
            "
          />
          <VImg
            v-else
            :src="'/images/svg/avatar-default.svg'"
            :alt="
              chatStore.activeChat.contact?.name ??
              chatStore.activeChat.name ??
              ''
            "
          />
        </VAvatar>
        <div class="photo-overlay">
          <VIcon icon="tabler-camera" size="32" class="d-flex" />
        </div>
      </div>
    </div>

    <!-- Contact Form -->
    <PerfectScrollbar
      class="ps-chat-user-profile-sidebar-content pb-6 px-6 flex-grow-1"
      :options="{ wheelPropagation: false }"
    >
      <VForm ref="refFormContact" @submit.prevent="saveContact">
        <VRow>
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
            />
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppTextField
              v-model="nickname"
              :label="$t('nickname') + ':'"
              :placeholder="$t('nickname')"
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppTextField
              v-model="emailFormatted"
              type="email"
              :label="$t('email') + ':'"
              :placeholder="$t('email')"
              :rules="[emailValidator]"
            >
              <template v-if="isContact" #append-inner>
                <VIcon
                  :icon="isEmailDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                  class="cursor-pointer"
                  :class="{ 'opacity-50': isLoadingEmail }"
                  @click="toggleEmailVisibility"
                />
              </template>
            </AppTextField>
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <div>
              <AppSelectSearch
                v-model="phone_ddi"
                :items="countryCodes"
                :label="$t('phone_ddi')"
                :placeholder="$t('select_phone_ddi')"
                :disabled="isContact"
                item-value="value"
                item-title="title"
              />
            </div>
          </VCol>

          <VCol cols="12" md="6">
            <div class="phone-field-wrapper">
              <AppTextField
                v-model="phoneFormatted"
                type="tel"
                :label="$t('phone') + ':'"
                :placeholder="$t('phone')"
                maxlength="15"
                :disabled="isContact"
                :readonly="isContact"
              />
              <VIcon
                v-if="isContact"
                size="17"
                :icon="isPhoneDecrypted ? 'tabler-eye-off' : 'tabler-eye'"
                class="cursor-pointer phone-eye-icon"
                :class="{ 'opacity-50': isLoadingPhone }"
                @click="togglePhoneVisibility"
              />
            </div>
          </VCol>
        </VRow>
        <VRow>
          <VCol cols="12" md="6">
            <AppDateTimePicker
              v-model="birthday"
              :label="$t('birthday') + ':'"
              :placeholder="$t('birthday')"
            />
          </VCol>

          <VCol cols="12" md="6">
            <AppSelect
              class="label-select"
              v-model="label_template_id"
              :items="itemsLabel"
              item-title="title"
              item-value="value"
              :label="$t('label') + ':'"
              :placeholder="$t('select_label')"
              clearable
              clear-icon="tabler-x"
              @click:clear="label_template_id = null"
            >
              <template #item="{ props, item }">
                <VListItem v-bind="props">
                  <template #prepend>
                    <div
                      v-if="item.raw.color"
                      class="label-color-circle"
                      :style="{ backgroundColor: item.raw.color }"
                    />
                  </template>
                </VListItem>
              </template>
              <template #selection="{ item }">
                <div v-if="item.raw" class="d-flex align-center gap-2">
                  <div
                    v-if="item.raw.color"
                    class="label-color-circle"
                    :style="{ backgroundColor: item.raw.color }"
                  />
                  <span>{{ item.raw.title }}</span>
                </div>
              </template>
            </AppSelect>
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

        <VCardText class="d-flex justify-end flex-wrap gap-3 pa-0 mt-4">
          <VBtn
            variant="tonal"
            color="secondary"
            :disabled="chatStore.loading"
            @click="$emit('close')"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn :loading="chatStore.loading" @click="saveContact">
            {{ isContact ? $t('save') : $t('add') }}
          </VBtn>
        </VCardText>
      </VForm>
    </PerfectScrollbar>

    <!-- Crop Modal -->
    <VDialog v-model="isCropModalOpen" max-width="600" persistent>
      <VCard>
        <VCardTitle class="d-flex align-center justify-space-between">
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
              style="
                max-width: 100%;
                max-height: 400px;
                display: block;
                margin: 0 auto;
              "
            />
            <div
              class="crop-area"
              :style="{
                position: 'absolute',
                left: `${cropArea.x}px`,
                top: `${cropArea.y}px`,
                width: `${cropArea.width}px`,
                height: `${cropArea.height}px`,
                border: '2px solid #fff',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
                cursor: cropArea.isDragging ? 'grabbing' : 'move',
              }"
              @mousedown="startCropDrag"
              @touchstart="startCropDrag"
            >
              <div
                class="crop-handle crop-handle-nw"
                @mousedown.stop="startCropResize('nw', $event)"
                @touchstart.stop="startCropResize('nw', $event)"
              />
              <div
                class="crop-handle crop-handle-ne"
                @mousedown.stop="startCropResize('ne', $event)"
                @touchstart.stop="startCropResize('ne', $event)"
              />
              <div
                class="crop-handle crop-handle-sw"
                @mousedown.stop="startCropResize('sw', $event)"
                @touchstart.stop="startCropResize('sw', $event)"
              />
              <div
                class="crop-handle crop-handle-se"
                @mousedown.stop="startCropResize('se', $event)"
                @touchstart.stop="startCropResize('se', $event)"
              />
            </div>
            <canvas ref="cropCanvasRef" style="display: none" />
          </div>
        </VCardText>
        <VDivider />
        <VCardText class="d-flex justify-end gap-3 flex-wrap">
          <VBtn variant="tonal" color="secondary" @click="cancelCrop">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="cropImage">
            {{ $t('apply_crop') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VDialog>
  </div>
</template>

<style scoped>
.phone-field-wrapper {
  position: relative;
}

.phone-eye-icon {
  position: absolute;
  right: 12px;
  bottom: 10px;
  z-index: 1;
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

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
  position: relative;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.crop-area {
  position: absolute;
  z-index: 10;
}

.crop-handle {
  position: absolute;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 2px solid #1976d2;
  border-radius: 50%;
  cursor: nwse-resize;
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

.label-color-circle {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}
</style>
