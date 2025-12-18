<script lang="ts" setup>
import { computed, nextTick, ref, toRef, watch } from 'vue';
import { VForm } from 'vuetify/components/VForm';
import { useTheme } from 'vuetify';
import { useAccountSettingsStore } from '@/@webcore/stores/accountSettings';
import { useI18n } from 'vue-i18n';
import { EContentWidth } from '@core/common/enums/EContentWidth';
import { EContentLayoutNav } from '@core/common/enums/EContentLayoutNav';
import { ELanguage } from '@core/common/enums/ELanguage';
import { ESkin } from '@core/common/enums/ESkin';
import { ENavbar } from '@core/common/enums/ENavbar';
import { EFooter } from '@core/common/enums/EFooter';
import { EColor } from '@core/common/enums/EColor';
import { applyLayoutTheme } from '@webcore/utils/applyLayoutTheme';
import { useConfigStore } from '@webcore/stores/config';
import { useLayoutConfigStore } from '@layouts/stores/config';
import { setLayout } from '@webcore/localStorage/user';

const accountSettingsStore = useAccountSettingsStore();
const { t } = useI18n();
const layoutThemeContext = {
  vuetifyTheme: useTheme(),
  configStore: useConfigStore(),
  layoutStore: useLayoutConfigStore(),
};

const props = defineProps<{
  accountId: string | null;
}>();

function appendIfDefined(fd: FormData, key: string, value: unknown) {
  if (value === null || value === undefined) return;
  if (typeof value === 'boolean') {
    fd.append(key, value ? 'true' : 'false');
    return;
  }
  fd.append(key, value as Blob | string);
}

function buildAccountInfoForm(opts: {
  logo?: File | null;
  shouldDeleteLogo?: boolean;
  name?: string | null;
  content_width: EContentWidth | null;
  content_layout_nav: EContentLayoutNav | null;
  default_locale: ELanguage | null;
  skin: ESkin | null;
  navbar: ENavbar | null;
  footer: EFooter | null;
  is_vertical_nav_collapsed: boolean | null;
  is_vertical_nav_semi_dark: boolean | null;
  light_primary_color: string | null;
  light_secondary_color: string | null;
  dark_primary_color: string | null;
  dark_secondary_color: string | null;
}) {
  const fd = new FormData();

  if (opts.shouldDeleteLogo) {
    fd.append('delete_logo', 'true');
  }

  if (!opts.shouldDeleteLogo && opts.logo instanceof File) {
    fd.append('logo', opts.logo);
  }

  appendIfDefined(fd, 'name', opts.name);

  appendIfDefined(fd, 'content_width', opts.content_width);
  appendIfDefined(fd, 'content_layout_nav', opts.content_layout_nav);
  appendIfDefined(fd, 'default_locale', opts.default_locale);
  appendIfDefined(fd, 'skin', opts.skin);
  appendIfDefined(fd, 'navbar', opts.navbar);
  appendIfDefined(fd, 'footer', opts.footer);
  appendIfDefined(
    fd,
    'is_vertical_nav_collapsed',
    opts.is_vertical_nav_collapsed
  );
  appendIfDefined(
    fd,
    'is_vertical_nav_semi_dark',
    opts.is_vertical_nav_semi_dark
  );
  appendIfDefined(fd, 'light_primary_color', opts.light_primary_color);
  appendIfDefined(fd, 'light_secondary_color', opts.light_secondary_color);
  appendIfDefined(fd, 'dark_primary_color', opts.dark_primary_color);
  appendIfDefined(fd, 'dark_secondary_color', opts.dark_secondary_color);

  return fd;
}

const itemsContentWidth = ref([
  { value: EContentWidth.fluid },
  { value: EContentWidth.boxed },
]);

const itemsContentLayoutNav = ref([
  { value: EContentLayoutNav.vertical },
  { value: EContentLayoutNav.horizontal },
]);

const itemsLanguage = ref([
  { value: ELanguage.en, title: t('english') },
  { value: ELanguage.es, title: t('spanish') },
  { value: ELanguage.pt, title: t('portuguese') },
]);

const itemsSkin = ref([{ value: ESkin.default }, { value: ESkin.bordered }]);

const itemsNavbar = ref([
  { value: ENavbar.sticky },
  { value: ENavbar.static },
  { value: ENavbar.hidden },
]);

const itemsFooter = ref([
  { value: EFooter.sticky },
  { value: EFooter.static },
  { value: EFooter.hidden },
]);

const accountId = toRef(props, 'accountId');
const accountInfoId = ref<string | null>(null);

const canEdit = ref<boolean>(true);

const accountName = ref<string>('');
const logoFile = ref<File | null>(null);
const logoUrl = ref<string | null>(null);
const shouldDeleteLogo = ref<boolean>(false);

const contentWidth = ref<string | null>(null);
const contentLayoutNav = ref<string | null>(null);
const defaultLocale = ref<string | null>(null);
const skin = ref<string | null>(null);
const navbar = ref<string | null>(null);
const footer = ref<string | null>(null);
const isVerticalNavCollapsed = ref<boolean | null>(null);
const isVerticalNavSemiDark = ref<boolean | null>(null);
const lightPrimaryColor = ref<string | null>(null);
const lightSecondaryColor = ref<string | null>(null);
const darkPrimaryColor = ref<string | null>(null);
const darkSecondaryColor = ref<string | null>(null);

const hasAccountInfo = computed(() => !!accountInfoId.value);

const refFormEditAccount = ref<VForm>();

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

const previewSrc = computed(() => {
  if (shouldDeleteLogo.value) return null;
  if (cropDialog.value.croppedImage) return cropDialog.value.croppedImage;
  return logoUrl.value;
});

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
      logoFile.value = file;
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

      const croppedFile = new File([blob], 'account-logo.jpg', {
        type: 'image/jpeg',
      });
      logoFile.value = croppedFile;
      cropDialog.value.croppedImage = canvas.toDataURL('image/jpeg');
      shouldDeleteLogo.value = false;
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
  logoFile.value = null;
};

const deleteLogo = () => {
  shouldDeleteLogo.value = true;
  logoFile.value = null;
  cropDialog.value.croppedImage = '';
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value);
    objectUrl.value = null;
  }
};

const objectUrl = ref<string | null>(null);

watch(logoFile, (file) => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = file ? URL.createObjectURL(file) : null;
});

onBeforeUnmount(() => {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
});

const updateAccountInfo = async () => {
  const validateForm = await refFormEditAccount?.value?.validate();
  if (!validateForm?.valid) return;
  if (!accountId.value) return;

  if (accountName.value && accountName.value.length > 10) {
    accountSettingsStore.showSnackbar(
      t('account_name_max_length'),
      EColor.error
    );
    return;
  }

  const body = buildAccountInfoForm({
    name:
      accountName.value && accountName.value.trim().length > 0
        ? accountName.value.trim()
        : null,
    logo: logoFile.value ?? null,
    shouldDeleteLogo: shouldDeleteLogo.value,
    content_width: contentWidth.value as EContentWidth,
    content_layout_nav: contentLayoutNav.value as EContentLayoutNav,
    default_locale: defaultLocale.value as ELanguage,
    skin: skin.value as ESkin,
    navbar: navbar.value as ENavbar,
    footer: footer.value as EFooter,
    is_vertical_nav_collapsed: isVerticalNavCollapsed.value,
    is_vertical_nav_semi_dark: isVerticalNavSemiDark.value,
    light_primary_color: lightPrimaryColor.value,
    light_secondary_color: lightSecondaryColor.value,
    dark_primary_color: darkPrimaryColor.value,
    dark_secondary_color: darkSecondaryColor.value,
  });

  const success = await accountSettingsStore.saveAccountInfo(body);
  if (!success) return;

  const updatedAccountInfo = await accountSettingsStore.getAccountInfoById();
  if (!updatedAccountInfo) return;

  setLayout(updatedAccountInfo);
  applyLayoutTheme(updatedAccountInfo, layoutThemeContext);
};

const addAccountInfo = async () => {
  const validateForm = await refFormEditAccount?.value?.validate();
  if (!validateForm?.valid) return;

  if (!accountId.value) return;

  if (accountName.value && accountName.value.length > 10) {
    accountSettingsStore.showSnackbar(
      t('account_name_max_length'),
      EColor.error
    );
    return;
  }

  const payload = buildAccountInfoForm({
    name:
      accountName.value && accountName.value.trim().length > 0
        ? accountName.value.trim()
        : null,
    logo: logoFile.value ?? null,
    shouldDeleteLogo: false,
    content_width: contentWidth.value as EContentWidth,
    content_layout_nav: contentLayoutNav.value as EContentLayoutNav,
    default_locale: defaultLocale.value as ELanguage,
    skin: skin.value as ESkin,
    navbar: navbar.value as ENavbar,
    footer: footer.value as EFooter,
    is_vertical_nav_collapsed: isVerticalNavCollapsed.value ?? false,
    is_vertical_nav_semi_dark: isVerticalNavSemiDark.value ?? true,
    light_primary_color: lightPrimaryColor.value,
    light_secondary_color: lightSecondaryColor.value,
    dark_primary_color: darkPrimaryColor.value,
    dark_secondary_color: darkSecondaryColor.value,
  });

  const success = await accountSettingsStore.saveAccountInfo(payload);
  if (!success) return;

  const updatedAccountInfo = await accountSettingsStore.getAccountInfoById();
  if (!updatedAccountInfo) return;

  setLayout(updatedAccountInfo);
  applyLayoutTheme(updatedAccountInfo, layoutThemeContext);
};

watch(
  () => props.accountId,
  async (newAccountId) => {
    if (!newAccountId) return;

    const account = await accountSettingsStore.getAccountInfoById();
    if (account) {
      accountInfoId.value = account.account_info_id;
      canEdit.value = account.can_edit ?? true;
      accountName.value = account.name ?? '';
      logoUrl.value = account.logo ?? null;
      shouldDeleteLogo.value = false;
      logoFile.value = null;
      cropDialog.value.croppedImage = '';
      contentWidth.value = account.content_width;
      contentLayoutNav.value = account.content_layout_nav;
      defaultLocale.value = account.default_locale;
      skin.value = account.skin;
      navbar.value = account.navbar;
      footer.value = account.footer;
      isVerticalNavCollapsed.value = account.is_vertical_nav_collapsed;
      isVerticalNavSemiDark.value = account.is_vertical_nav_semi_dark;
      lightPrimaryColor.value = account.light_primary_color;
      lightSecondaryColor.value = account.light_secondary_color;
      darkPrimaryColor.value = account.dark_primary_color;
      darkSecondaryColor.value = account.dark_secondary_color;
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="account-info-inline">
    <VOverlay
      :model-value="accountSettingsStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormEditAccount" @submit.prevent>
      <VCard variant="elevated" class="account-settings-card">
        <VCardTitle class="text-h6 pa-6 pb-4">
          {{ $t('account_info') }}
        </VCardTitle>
        <VDivider />
        <VCardText>
          <VRow>
            <VCol cols="12" md="6">
              <AppTextField
                v-model="accountName"
                :label="$t('account_name')"
                :rules="[
                  (v: string) =>
                    !v || v.length <= 10 || $t('account_name_max_length'),
                ]"
                :maxlength="10"
                :disabled="!canEdit"
                counter
                variant="outlined"
                dense
              />
            </VCol>

            <VCol cols="12">
              <VDivider class="my-4" />
              <h3 class="text-h6 mb-4">{{ $t('logo') }}</h3>
            </VCol>

            <VCol cols="12" md="6">
              <div v-if="previewSrc" class="logo-preview-container">
                <VImg
                  :src="previewSrc"
                  max-height="200"
                  max-width="200"
                  class="rounded"
                  cover
                />
              </div>
              <div v-else class="logo-placeholder">
                <VIcon icon="tabler-photo" size="48" />
                <span class="text-body-2 mt-2">{{ $t('no_logo') }}</span>
              </div>
            </VCol>

            <VCol cols="12" md="6">
              <div class="d-flex flex-column gap-3">
                <VBtn
                  color="primary"
                  variant="outlined"
                  :disabled="!canEdit"
                  @click="openFileSelector"
                >
                  <VIcon icon="tabler-upload" class="me-2" />
                  {{ $t('upload_logo') }}
                </VBtn>
                <VBtn
                  v-if="previewSrc && !shouldDeleteLogo"
                  color="error"
                  variant="outlined"
                  :disabled="!canEdit"
                  @click="deleteLogo"
                >
                  <VIcon icon="tabler-trash" class="me-2" />
                  {{ $t('delete_logo') }}
                </VBtn>
              </div>
            </VCol>

            <VCol cols="12">
              <VDivider class="my-4" />
              <h3 class="text-h6 mb-4">{{ $t('layout_settings') }}</h3>
            </VCol>

            <VCol cols="12" sm="6" md="4">
              <label
                :for="'content-width-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('content_width') }}:
              </label>
              <VSelect
                :id="'content-width-select'"
                :items="itemsContentWidth"
                item-title="value"
                item-value="value"
                v-model="contentWidth"
                :disabled="!canEdit"
                dense
                variant="outlined"
                hide-details
              />
            </VCol>

            <VCol cols="12" sm="6" md="4">
              <label
                :for="'content-layout-nav-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('content_layout_nav') }}:
              </label>
              <VSelect
                :id="'content-layout-nav-select'"
                :items="itemsContentLayoutNav"
                item-title="value"
                item-value="value"
                v-model="contentLayoutNav"
                :disabled="!canEdit"
                dense
                variant="outlined"
                hide-details
              />
            </VCol>

            <VCol cols="12" sm="6" md="4">
              <label
                :for="'default-locale-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('default_locale') }}:
              </label>
              <VSelect
                :id="'default-locale-select'"
                :items="itemsLanguage"
                item-title="title"
                item-value="value"
                v-model="defaultLocale"
                :disabled="!canEdit"
                dense
                variant="outlined"
                hide-details
              />
            </VCol>

            <VCol cols="12" sm="6" md="4">
              <label
                :for="'skin-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('skin') }}:
              </label>
              <VSelect
                :id="'skin-select'"
                :items="itemsSkin"
                item-title="value"
                item-value="value"
                v-model="skin"
                :disabled="!canEdit"
                dense
                variant="outlined"
                hide-details
              />
            </VCol>

            <VCol cols="12" sm="6" md="4">
              <label
                :for="'navbar-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('navbar') }}:
              </label>
              <VSelect
                :id="'navbar-select'"
                :items="itemsNavbar"
                item-title="value"
                item-value="value"
                v-model="navbar"
                :disabled="!canEdit"
                dense
                variant="outlined"
                hide-details
              />
            </VCol>

            <VCol cols="12" sm="6" md="4">
              <label
                :for="'footer-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('footer') }}:
              </label>
              <VSelect
                :id="'footer-select'"
                :items="itemsFooter"
                item-title="value"
                item-value="value"
                v-model="footer"
                :disabled="!canEdit"
                dense
                variant="outlined"
                hide-details
              />
            </VCol>

            <VCol cols="12">
              <VDivider class="my-4" />
              <h3 class="text-h6 mb-4">{{ $t('color_settings') }}</h3>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="light-primary-color" class="mb-0 fw-semibold">
                    {{ $t('light_primary_color') }}:
                  </label>
                  <span class="color-value">{{
                    lightPrimaryColor?.toUpperCase()
                  }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    id="light-primary-color"
                    type="color"
                    v-model="lightPrimaryColor"
                    :disabled="!canEdit"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: lightPrimaryColor || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="light-secondary-color" class="mb-0 fw-semibold">
                    {{ $t('light_secondary_color') }}:
                  </label>
                  <span class="color-value">{{
                    lightSecondaryColor?.toUpperCase()
                  }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    id="light-secondary-color"
                    type="color"
                    v-model="lightSecondaryColor"
                    :disabled="!canEdit"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: lightSecondaryColor || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="dark-primary-color" class="mb-0 fw-semibold">
                    {{ $t('dark_primary_color') }}:
                  </label>
                  <span class="color-value">{{
                    darkPrimaryColor?.toUpperCase()
                  }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    id="dark-primary-color"
                    type="color"
                    v-model="darkPrimaryColor"
                    :disabled="!canEdit"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: darkPrimaryColor || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label for="dark-secondary-color" class="mb-0 fw-semibold">
                    {{ $t('dark_secondary_color') }}:
                  </label>
                  <span class="color-value">{{
                    darkSecondaryColor?.toUpperCase()
                  }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    id="dark-secondary-color"
                    type="color"
                    v-model="darkSecondaryColor"
                    :disabled="!canEdit"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: darkSecondaryColor || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>

            <VCol cols="12">
              <VDivider class="my-4" />
              <h3 class="text-h6 mb-4">{{ $t('navigation_settings') }}</h3>
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <VCheckbox
                v-model="isVerticalNavCollapsed"
                :label="t('is_vertical_nav_collapsed')"
                :disabled="!canEdit"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <VCheckbox
                v-model="isVerticalNavSemiDark"
                :label="t('is_vertical_nav_semi_dark')"
                :disabled="!canEdit"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VDivider />

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <template v-if="hasAccountInfo">
            <VBtn color="primary" :disabled="!canEdit" @click="updateAccountInfo">
              {{ $t('update') }}
            </VBtn>
          </template>

          <template v-else>
            <VBtn color="primary" :disabled="!canEdit" @click="addAccountInfo">
              {{ $t('add') }}
            </VBtn>
          </template>
        </VCardText>
      </VCard>
    </VForm>
  </div>

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

  <VSnackbar
    v-model="accountSettingsStore.snackbar.status"
    transition="scroll-y-reverse-transition"
    location="top end"
    :color="accountSettingsStore.snackbar.color"
  >
    {{ accountSettingsStore.snackbar.message }}
  </VSnackbar>
</template>

<style scoped>
.account-info-inline {
  position: relative;
}
</style>

<style scoped>
.account-info-inline {
  position: relative;
}
</style>

<style lang="scss" scoped>
.logo-preview-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  padding: 16px;
}

.logo-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border: 2px dashed rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.5);
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

.color-input {
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.swatch-large {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}

.color-value {
  font-size: 0.875rem;
  color: rgba(var(--v-theme-on-surface), 0.7);
}

.account-settings-card {
  background-color: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
  border-radius: 8px;
}
</style>
