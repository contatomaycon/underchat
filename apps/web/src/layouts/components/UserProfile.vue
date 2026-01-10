<script setup lang="ts">
import { clearAllData } from '@/@webcore/utils/clearAllData';
import { presenceOffline } from '@/@webcore/presence';
import { initUserPresenceSubscription } from '@/@webcore/presenceCentrifugo';
import { useChatStore } from '@/@webcore/stores/chat';
import { useProfileStore } from '@/@webcore/stores/profile';
import { EChatUserStatus } from '@core/common/enums/EChatUserStatus';
import { EColor } from '@core/common/enums/EColor';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EPlanPermissions } from '@core/common/enums/EPermissions/plan';
import { EAccountPermissions } from '@core/common/enums/EPermissions/account';
import { useTheme } from 'vuetify';
import { useAbility } from '@/plugins/0.casl/composables/useAbility';
import { unsubscribeFromPushNotifications } from '@/composables/useChatNotifications';

const router = useRouter();
const chatStore = useChatStore();
const profileStore = useProfileStore();
const { t } = useI18n();
const { global } = useTheme();
const ability = useAbility();

const canAccessPlanInvoice = computed(() => {
  const permissions = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EPlanPermissions.plan_group,
    EPlanPermissions.plan_invoice,
  ];

  return permissions.some((perm) => ability.can(perm, perm));
});

const canCustomizeAccount = computed(() => {
  const permissions = [
    EGeneralPermissions.full_access,
    EGeneralPermissions.full_access_group,
    EAccountPermissions.account_group,
    EAccountPermissions.account_customize,
  ];

  return permissions.some((perm) => ability.can(perm, perm));
});

const navigateToAccountSettings = (tab: string) => {
  router.push({ name: 'account-settings', query: { tab } });
};

const isPhotoModalOpen = ref(false);
const isCropModalOpen = ref(false);
const isUploadingPhoto = ref(false);
const cropImageRef = ref<HTMLImageElement | null>(null);
const cropCanvasRef = ref<HTMLCanvasElement | null>(null);
const photoFile = ref<File | null>(null);
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

const openPhotoModal = () => {
  isPhotoModalOpen.value = true;
};

const closePhotoModal = () => {
  isPhotoModalOpen.value = false;
  cropDialog.value.imageSrc = '';
  cropDialog.value.croppedImage = '';
  photoFile.value = null;
};

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
    profileStore.showSnackbar(
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
  const size = Math.max(Math.abs(deltaX), Math.abs(deltaY));

  const { x: initialX, y: initialY } = calculateInitialPosition(
    handle,
    fixedX,
    fixedY,
    size
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
    profileStore.showSnackbar(t('wait_image_load'), EColor.warning);
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
  if (!chatStore.user?.user_id) return;

  isUploadingPhoto.value = true;

  const result = await profileStore.uploadUserPhoto(
    chatStore.user.user_id,
    file
  );

  if (result) {
    closePhotoModal();
  }

  isUploadingPhoto.value = false;
};

const removePhoto = async () => {
  if (!chatStore.user?.user_id) return;

  isUploadingPhoto.value = true;

  const result = await profileStore.removeUserPhoto(chatStore.user.user_id);

  if (result) {
    closePhotoModal();
  }

  isUploadingPhoto.value = false;
};

const isLoggingOut = ref(false);

const logout = async () => {
  isLoggingOut.value = true;

  try {
    await presenceOffline().catch(() => {});

    await unsubscribeFromPushNotifications().catch(() => {});

    clearAllData();

    await nextTick(() => {
      router.replace({
        name: 'login',
      });
    });
  } finally {
    isLoggingOut.value = false;
  }
};

onMounted(() => {
  if (chatStore.user?.account_id) {
    initUserPresenceSubscription(chatStore.user.account_id).catch(() => {});
  }
});
</script>

<template>
  <VBadge
    dot
    location="bottom right"
    offset-x="3"
    offset-y="3"
    bordered
    :color="
      resolveAvatarBadgeVariant(
        chatStore.user?.chat_user?.status as EChatUserStatus,
        global.name.value === 'dark'
      )
    "
  >
    <VAvatar class="cursor-pointer" color="primary" variant="tonal">
      <VImg
        v-if="chatStore.user?.info.photo"
        :src="chatStore.user?.info.photo"
      />
      <VImg v-else :src="'/images/svg/avatar-default.svg'" alt="Avatar" />

      <!-- SECTION Menu -->
      <VMenu activator="parent" width="230" location="bottom end" offset="14px">
        <VList>
          <!-- 👉 User Avatar & Name -->
          <VListItem>
            <template #prepend>
              <VListItemAction start>
                <VBadge
                  dot
                  location="bottom right"
                  offset-x="3"
                  offset-y="3"
                  :color="
                    resolveAvatarBadgeVariant(
                      chatStore.user?.chat_user?.status as EChatUserStatus
                    )
                  "
                >
                  <VAvatar color="primary" variant="tonal">
                    <VImg
                      v-if="chatStore.user?.info.photo"
                      :src="chatStore.user?.info.photo"
                    />
                    <VImg
                      v-else
                      :src="'/images/svg/avatar-default.svg'"
                      alt="Avatar"
                    />
                  </VAvatar>
                </VBadge>
              </VListItemAction>
            </template>

            <VListItemTitle class="font-weight-semibold">
              {{ chatStore.user?.info.name }}
            </VListItemTitle>
            <VListItemSubtitle>{{
              chatStore.user?.type.name
            }}</VListItemSubtitle>
          </VListItem>

          <VDivider class="my-2" />

          <!-- 👉 Change Photo -->
          <VListItem @click="openPhotoModal" link>
            <template #prepend>
              <VIcon class="me-2" icon="tabler-camera" size="22" />
            </template>

            <VListItemTitle>{{ $t('change_photo') }}</VListItemTitle>
          </VListItem>

          <!-- 👉 Account Settings -->
          <VListItem @click="navigateToAccountSettings('account')" link>
            <template #prepend>
              <VIcon class="me-2" icon="tabler-user" size="22" />
            </template>

            <VListItemTitle>{{ $t('account') }}</VListItemTitle>
          </VListItem>

          <VListItem @click="navigateToAccountSettings('security')" link>
            <template #prepend>
              <VIcon class="me-2" icon="tabler-lock" size="22" />
            </template>

            <VListItemTitle>{{ $t('security') }}</VListItemTitle>
          </VListItem>

          <VListItem
            v-if="canCustomizeAccount"
            @click="navigateToAccountSettings('customize')"
            link
          >
            <template #prepend>
              <VIcon class="me-2" icon="tabler-palette" size="22" />
            </template>

            <VListItemTitle>{{ $t('customize') }}</VListItemTitle>
          </VListItem>

          <VListItem
            v-if="canAccessPlanInvoice"
            @click="navigateToAccountSettings('plans')"
            link
          >
            <template #prepend>
              <VIcon class="me-2" icon="tabler-package" size="22" />
            </template>

            <VListItemTitle>{{ $t('plans') }}</VListItemTitle>
          </VListItem>

          <VListItem
            v-if="canAccessPlanInvoice"
            @click="navigateToAccountSettings('invoices')"
            link
          >
            <template #prepend>
              <VIcon class="me-2" icon="tabler-receipt-2" size="22" />
            </template>

            <VListItemTitle>{{ $t('invoices') }}</VListItemTitle>
          </VListItem>

          <VDivider class="my-2" />

          <VListItem @click="logout" link :disabled="isLoggingOut">
            <template #prepend>
              <VIcon class="me-2" icon="tabler-logout" size="22" />
            </template>

            <VListItemTitle>
              <span v-if="isLoggingOut">{{ $t('logging_out') }}...</span>
              <span v-else>Logout</span>
            </VListItemTitle>
          </VListItem>
        </VList>
      </VMenu>
    </VAvatar>
  </VBadge>

  <!-- Photo Modal -->
  <VDialog v-model="isPhotoModalOpen" max-width="500" persistent>
    <VOverlay
      :model-value="isUploadingPhoto"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{ $t('profile_photo') }}</span>
        <IconBtn @click="closePhotoModal" :disabled="isUploadingPhoto">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </VCardTitle>

      <VCardText class="text-center">
        <VAvatar size="200" class="mb-4">
          <VImg
            v-if="chatStore.user?.info.photo"
            :src="chatStore.user?.info.photo"
          />
          <VImg v-else :src="'/images/svg/avatar-default.svg'" alt="Avatar" />
        </VAvatar>

        <div class="d-flex flex-column gap-3">
          <VBtn
            color="primary"
            :loading="isUploadingPhoto"
            :disabled="isUploadingPhoto"
            @click="openFileSelector"
          >
            <VIcon icon="tabler-upload" class="me-2" />
            {{ $t('change_photo') }}
          </VBtn>

          <VBtn
            v-if="chatStore.user?.info.photo"
            color="error"
            variant="outlined"
            :loading="isUploadingPhoto"
            :disabled="isUploadingPhoto"
            @click="removePhoto"
          >
            <VIcon icon="tabler-trash" class="me-2" />
            {{ $t('remove_photo') }}
          </VBtn>
        </div>
      </VCardText>
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
        <VBtn color="primary" :loading="isUploadingPhoto" @click="cropImage">
          {{ $t('apply_crop') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>

  <VSnackbar
    v-model="profileStore.snackbar.status"
    transition="scroll-y-reverse-transition"
    location="top end"
    :color="profileStore.snackbar.color"
  >
    {{ profileStore.snackbar.message }}
  </VSnackbar>
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
</style>
