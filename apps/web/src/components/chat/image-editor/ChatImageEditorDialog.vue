<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, useTemplateRef, watch } from 'vue';
import { Picker, EmojiIndex } from 'emoji-mart-vue-fast/src';
import data from 'emoji-mart-vue-fast/data/all.json';
import 'emoji-mart-vue-fast/css/emoji-mart.css';
import { useI18n } from 'vue-i18n';
import { useDisplay } from 'vuetify';
import type {
  ChatEditablePhotoPreview,
  ChatImageEditorFilter,
  ChatImageEditorShape,
  ChatImageEditorTool,
} from './types';
import { useChatImageCanvasEditor } from './useChatImageCanvasEditor';

const photosModel = defineModel<ChatEditablePhotoPreview[]>('photos', {
  required: true,
});
const captionModel = defineModel<string>('caption', { default: '' });
const openModel = defineModel<boolean>('open', { required: true });

const props = defineProps<{
  initialPhotoId?: string | null;
}>();

const emit = defineEmits<{
  close: [];
  send: [];
}>();

const { t } = useI18n();
const { smAndDown } = useDisplay();
const emojiIndex = new EmojiIndex(data);
const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const textOverlayRef = useTemplateRef<HTMLTextAreaElement>('textOverlayRef');
const viewportRef = useTemplateRef<HTMLElement>('viewportRef');
const editor = useChatImageCanvasEditor({ canvasRef, viewportRef });

const activePhotoId = shallowRef<string | null>(null);
const activeTool = shallowRef<ChatImageEditorTool>('crop');
const brushColor = shallowRef('#25d366');
const shapeColor = shallowRef('#ffffff');
const brushWidth = shallowRef(5);
const blurIntensity = shallowRef(50);
const selectedShape = shallowRef<ChatImageEditorShape>('rect');
const isExporting = shallowRef(false);
const isEmojiMenuOpen = shallowRef(false);

const activePhoto = computed(() => {
  return photosModel.value.find((photo) => photo.id === activePhotoId.value) ?? null;
});

const editablePhotos = computed(() => {
  return photosModel.value.filter((photo) => !isGifPhoto(photo));
});

const canEditActivePhoto = computed(() => {
  return !!activePhoto.value && !isGifPhoto(activePhoto.value);
});

const toolItems = computed<
  Array<{ value: ChatImageEditorTool; icon: string; label: string }>
>(() => [
  {
    value: 'crop',
    icon: 'tabler-crop',
    label: t('chat_image_editor_crop_rotate'),
  },
  {
    value: 'filter',
    icon: 'tabler-wand',
    label: t('chat_image_editor_filter'),
  },
  {
    value: 'draw',
    icon: 'tabler-pencil',
    label: t('chat_image_editor_draw'),
  },
  {
    value: 'text',
    icon: 'tabler-text-size',
    label: t('chat_image_editor_text'),
  },
  {
    value: 'shape',
    icon: 'tabler-square',
    label: t('chat_image_editor_shapes'),
  },
  {
    value: 'blur',
    icon: 'tabler-blur',
    label: t('chat_image_editor_blur'),
  },
  {
    value: 'emoji',
    icon: 'tabler-mood-smile',
    label: t('chat_image_editor_emoji'),
  },
]);

const filterItems = computed<
  Array<{ value: ChatImageEditorFilter; label: string; className: string }>
>(() => [
  {
    value: 'none',
    label: t('chat_image_filter_none'),
    className: 'filter-none',
  },
  { value: 'pop', label: t('chat_image_filter_pop'), className: 'filter-pop' },
  {
    value: 'grayscale',
    label: t('chat_image_filter_grayscale'),
    className: 'filter-grayscale',
  },
  {
    value: 'cold',
    label: t('chat_image_filter_cold'),
    className: 'filter-cold',
  },
  {
    value: 'chrome',
    label: t('chat_image_filter_chrome'),
    className: 'filter-chrome',
  },
  {
    value: 'film',
    label: t('chat_image_filter_film'),
    className: 'filter-film',
  },
]);

const shapeItems = computed<
  Array<{ value: ChatImageEditorShape; icon: string; label: string }>
>(() => [
  { value: 'rect', icon: 'tabler-square', label: t('chat_image_shape_rect') },
  { value: 'circle', icon: 'tabler-circle', label: t('chat_image_shape_circle') },
  { value: 'line', icon: 'tabler-minus', label: t('chat_image_shape_line') },
  { value: 'arrow', icon: 'tabler-arrow-right', label: t('chat_image_shape_arrow') },
]);

const isGifPhoto = (photo: ChatEditablePhotoPreview): boolean => {
  const extension = photo.file.name.split('.').pop()?.toLowerCase();
  return photo.file.type === 'image/gif' || extension === 'gif';
};

const setActivePhoto = async (photoId: string) => {
  const photo = photosModel.value.find((item) => item.id === photoId);
  if (!photo) return;

  activePhotoId.value = photoId;
  await nextTick();

  if (isGifPhoto(photo)) {
    editor.dispose();
    return;
  }

  await editor.loadImage(photo.preview);
  selectTool(activeTool.value);
};

const selectFirstEditablePhoto = async () => {
  const initialPhoto = props.initialPhotoId
    ? photosModel.value.find((photo) => photo.id === props.initialPhotoId)
    : null;
  if (initialPhoto && !isGifPhoto(initialPhoto)) {
    await setActivePhoto(initialPhoto.id);
    return;
  }

  const currentPhoto = activePhoto.value;
  if (currentPhoto && photosModel.value.some((photo) => photo.id === currentPhoto.id)) {
    await setActivePhoto(currentPhoto.id);
    return;
  }

  const firstEditable = editablePhotos.value[0] ?? photosModel.value[0] ?? null;
  if (firstEditable) {
    await setActivePhoto(firstEditable.id);
    return;
  }

  activePhotoId.value = null;
};

const selectTool = (tool: ChatImageEditorTool) => {
  activeTool.value = tool;
  editor.resetInteraction();
  isEmojiMenuOpen.value = false;

  if (tool === 'draw') {
    editor.setDrawingMode(true, {
      color: brushColor.value,
      width: brushWidth.value,
    });
    return;
  }

  if (tool === 'blur') {
    editor.createBlurOverlay(blurIntensity.value);
    return;
  }

  if (tool === 'crop') {
    editor.createCropRect();
  }
};

const updateDrawingBrush = () => {
  if (activeTool.value !== 'draw') return;

  editor.setDrawingMode(true, {
    color: brushColor.value,
    width: brushWidth.value,
  });
};

const updateBlurIntensity = () => {
  if (activeTool.value !== 'blur') return;
  editor.updateBlurIntensity(blurIntensity.value);
};

const updatePhoto = (
  photoId: string,
  patch: Partial<ChatEditablePhotoPreview>
) => {
  photosModel.value = photosModel.value.map((photo) =>
    photo.id === photoId ? { ...photo, ...patch } : photo
  );
};

const applyCurrentImage = async (): Promise<boolean> => {
  const photo = activePhoto.value;
  if (!photo || !canEditActivePhoto.value) return false;

  isExporting.value = true;
  try {
    const result =
      activeTool.value === 'crop'
        ? await editor.applyCrop(photo.file)
        : await editor.exportVisibleCanvas(photo.file);

    if (!result) return false;

    updatePhoto(photo.id, {
      file: result.file,
      preview: result.preview,
      edited: true,
      cropReset: activeTool.value === 'crop' ? result.cropReset ?? null : null,
    });
    await nextTick();
    await editor.loadImage(result.preview);

    if (activeTool.value === 'draw' || activeTool.value === 'blur') {
      selectTool(activeTool.value);
    } else {
      editor.resetInteraction();
    }

    return true;
  } finally {
    isExporting.value = false;
  }
};

const removePhoto = async (photoId: string) => {
  photosModel.value = photosModel.value.filter((photo) => photo.id !== photoId);
  if (activePhotoId.value === photoId) {
    await selectFirstEditablePhoto();
  }
};

const handleClose = () => {
  editor.dispose();
  openModel.value = false;
  emit('close');
};

const handleApply = () => {
  void applyCurrentImage();
};

const handleResetCropAndRotation = async () => {
  const photo = activePhoto.value;
  if (!photo?.cropReset) {
    editor.resetCropAndRotation();
    return;
  }

  updatePhoto(photo.id, {
    file: photo.cropReset.file,
    preview: photo.cropReset.preview,
    edited: photo.cropReset.edited,
    cropReset: null,
  });
  await nextTick();
  await editor.loadImage(photo.cropReset.preview);
  editor.resetCropAndRotation();
};

const handleCropClick = async () => {
  if (!editor.hasCropRect.value) {
    editor.createCropRect();
    return;
  }

  await applyCurrentImage();
};

const handleSend = async () => {
  if (canEditActivePhoto.value) {
    await applyCurrentImage();
  }

  editor.dispose();
  openModel.value = false;
  emit('send');
};

const handleFilterClick = (filter: ChatImageEditorFilter) => {
  editor.applyFilter(filter);
};

const handleAddShape = () => {
  editor.addShape(selectedShape.value, shapeColor.value);
};

const handleAddText = async () => {
  editor.addText(t('chat_image_editor_text_placeholder'));
  await nextTick();
  textOverlayRef.value?.focus();
  textOverlayRef.value?.select();
};

const handleEmojiSelect = (emoji: { native?: string; colons?: string }) => {
  const emojiText = emoji.native || emoji.colons || '';
  editor.addEmoji(emojiText);
  isEmojiMenuOpen.value = false;
};

watch(
  openModel,
  async (isOpen) => {
    if (!isOpen) return;
    await nextTick();
    await selectFirstEditablePhoto();
  }
);

watch(
  () => photosModel.value.length,
  async () => {
    if (!openModel.value) return;
    await selectFirstEditablePhoto();
  }
);

watch([brushColor, brushWidth], updateDrawingBrush);
watch(blurIntensity, updateBlurIntensity);
</script>

<template>
  <div v-if="openModel" class="chat-image-editor">
      <header class="chat-image-editor__header">
        <IconBtn :aria-label="t('cancel')" @click="handleClose">
          <VIcon size="24">tabler-x</VIcon>
        </IconBtn>

        <div class="chat-image-editor__title">
          <strong>{{ t('chat_image_editor_title') }}</strong>
          <span>{{ photosModel.length }}/10</span>
        </div>

        <div class="chat-image-editor__header-actions">
          <VBtn
            variant="tonal"
            color="primary"
            :disabled="!canEditActivePhoto || isExporting"
            :loading="isExporting"
            @click="handleApply"
          >
            {{ t('chat_image_editor_apply') }}
          </VBtn>
          <VBtn
            color="success"
            variant="flat"
            icon
            :aria-label="t('chat_image_editor_send')"
            :disabled="photosModel.length === 0 || isExporting"
            @click="handleSend"
          >
            <VIcon size="22">tabler-send</VIcon>
          </VBtn>
        </div>
      </header>

      <aside class="chat-image-editor__tools" :class="{ 'is-mobile': smAndDown }">
        <VTooltip
          v-for="tool in toolItems"
          :key="tool.value"
          location="top"
          :text="tool.label"
        >
          <template #activator="{ props }">
            <IconBtn
              v-bind="props"
              class="chat-image-editor__tool-btn"
              :class="{ 'is-active': activeTool === tool.value }"
              :disabled="!canEditActivePhoto"
              :aria-label="tool.label"
              @click="selectTool(tool.value)"
            >
              <VIcon size="23">{{ tool.icon }}</VIcon>
            </IconBtn>
          </template>
        </VTooltip>
      </aside>

      <main ref="viewportRef" class="chat-image-editor__stage">
        <div v-if="activePhoto && isGifPhoto(activePhoto)" class="chat-image-editor__gif-preview">
          <VImg :src="activePhoto.preview" :alt="activePhoto.file.name" max-height="70vh" />
          <VAlert type="info" variant="tonal" class="mt-4">
            {{ t('chat_image_editor_gif_notice') }}
          </VAlert>
        </div>

        <div
          v-show="activePhoto && !isGifPhoto(activePhoto)"
          class="chat-image-editor__canvas-wrap"
        >
          <canvas
            ref="canvasRef"
            class="chat-image-editor__canvas"
          ></canvas>

          <textarea
            v-if="editor.textOverlay.visible"
            ref="textOverlayRef"
            v-model="editor.textOverlay.text"
            class="chat-image-editor__text-overlay"
            rows="1"
            :style="editor.textOverlayStyle.value"
            @pointerdown="editor.startTextDrag"
            @pointermove="editor.moveTextDrag"
            @pointerup="editor.endTextDrag"
            @pointercancel="editor.endTextDrag"
          ></textarea>

          <div
            v-if="editor.shapeOverlay.visible"
            class="chat-image-editor__shape-overlay"
            :class="`is-${editor.shapeOverlay.shape}`"
            :style="editor.shapeOverlayStyle.value"
            @pointerdown="editor.startShapeDrag"
            @pointermove="editor.moveShapeDrag"
            @pointerup="editor.endShapeDrag"
            @pointercancel="editor.endShapeDrag"
          >
            <span class="chat-image-editor__shape-rotate-line"></span>
            <span
              class="chat-image-editor__shape-rotate"
              @pointerdown.stop="editor.startShapeRotate"
              @pointermove.stop="editor.moveShapeRotate"
              @pointerup.stop="editor.endShapeRotate"
              @pointercancel.stop="editor.endShapeRotate"
            >
              <VIcon size="14">tabler-rotate-clockwise</VIcon>
            </span>

            <svg class="chat-image-editor__shape-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
              <rect
                v-if="editor.shapeOverlay.shape === 'rect'"
                x="3"
                y="3"
                width="94"
                height="94"
                rx="1"
                ry="1"
              />
              <ellipse
                v-else-if="editor.shapeOverlay.shape === 'circle'"
                cx="50"
                cy="50"
                rx="46"
                ry="46"
              />
              <line
                v-else
                x1="4"
                y1="50"
                x2="96"
                y2="50"
              />
              <polygon
                v-if="editor.shapeOverlay.shape === 'arrow'"
                points="96,50 82,39 82,61"
              />
            </svg>

            <span
              class="chat-image-editor__shape-resize"
              @pointerdown.stop="editor.startShapeResize"
              @pointermove.stop="editor.moveShapeResize"
              @pointerup.stop="editor.endShapeResize"
              @pointercancel.stop="editor.endShapeResize"
            ></span>
          </div>

          <div
            v-if="editor.blurOverlay.visible"
            class="chat-image-editor__blur-overlay"
            :style="editor.blurOverlayStyle.value"
            @pointerdown="editor.startBlurDrag"
            @pointermove="editor.moveBlurDrag"
            @pointerup="editor.endBlurDrag"
            @pointercancel="editor.endBlurDrag"
          >
            <span
              v-for="handle in 8"
              :key="handle"
              class="chat-image-editor__blur-handle"
              :class="`is-${handle}`"
            ></span>
            <span
              class="chat-image-editor__blur-resize"
              @pointerdown.stop="editor.startBlurResize"
              @pointermove.stop="editor.moveBlurResize"
              @pointerup.stop="editor.endBlurResize"
              @pointercancel.stop="editor.endBlurResize"
            ></span>
          </div>

          <div
            v-if="editor.emojiOverlay.visible"
            class="chat-image-editor__emoji-overlay"
            :style="editor.emojiOverlayStyle.value"
            @pointerdown="editor.startEmojiDrag"
            @pointermove="editor.moveEmojiDrag"
            @pointerup="editor.endEmojiDrag"
            @pointercancel="editor.endEmojiDrag"
          >
            <span class="chat-image-editor__emoji-glyph">
              {{ editor.emojiOverlay.emoji }}
            </span>
            <span
              class="chat-image-editor__emoji-resize"
              @pointerdown.stop="editor.startEmojiResize"
              @pointermove.stop="editor.moveEmojiResize"
              @pointerup.stop="editor.endEmojiResize"
              @pointercancel.stop="editor.endEmojiResize"
            ></span>
          </div>
        </div>

        <div v-if="!activePhoto" class="chat-image-editor__empty">
          {{ t('chat_image_editor_empty') }}
        </div>
      </main>

      <section class="chat-image-editor__options">
        <div v-if="activeTool === 'crop'" class="chat-image-editor__option-row">
          <VBtn
            size="small"
            variant="tonal"
            :disabled="!canEditActivePhoto || isExporting"
            :loading="isExporting"
            @click="handleCropClick"
          >
            <VIcon start size="18">tabler-crop</VIcon>
            {{ t('chat_image_editor_crop') }}
          </VBtn>
          <VBtn
            size="small"
            variant="tonal"
            :disabled="!canEditActivePhoto"
            @click="editor.rotate(90)"
          >
            <VIcon start size="18">tabler-rotate-clockwise</VIcon>
            {{ t('chat_image_editor_rotate') }}
          </VBtn>
          <VBtn
            size="small"
            variant="text"
            :disabled="!canEditActivePhoto"
            @click="handleResetCropAndRotation"
          >
            {{ t('chat_image_editor_reset') }}
          </VBtn>
        </div>

        <div v-else-if="activeTool === 'filter'" class="chat-image-editor__filters">
          <button
            v-for="filter in filterItems"
            :key="filter.value"
            class="chat-image-editor__filter"
            :class="{ 'is-active': editor.activeFilter.value === filter.value }"
            type="button"
            :disabled="!canEditActivePhoto"
            @click="handleFilterClick(filter.value)"
          >
            <span :class="['chat-image-editor__filter-swatch', filter.className]">
              <VImg
                v-if="activePhoto"
                :src="activePhoto.preview"
                :alt="filter.label"
                cover
              />
            </span>
            <span>{{ filter.label }}</span>
          </button>
        </div>

        <div v-else-if="activeTool === 'draw'" class="chat-image-editor__option-row">
          <VTooltip location="top" :text="t('chat_image_editor_undo')">
            <template #activator="{ props }">
              <IconBtn
                v-bind="props"
                :disabled="!editor.canUndo.value"
                :aria-label="t('chat_image_editor_undo')"
                @click="editor.undo"
              >
                <VIcon size="20">tabler-arrow-back-up</VIcon>
              </IconBtn>
            </template>
          </VTooltip>
          <VTooltip location="top" :text="t('chat_image_editor_redo')">
            <template #activator="{ props }">
              <IconBtn
                v-bind="props"
                :disabled="!editor.canRedo.value"
                :aria-label="t('chat_image_editor_redo')"
                @click="editor.redo"
              >
                <VIcon size="20">tabler-arrow-forward-up</VIcon>
              </IconBtn>
            </template>
          </VTooltip>
          <input
            v-if="activeTool === 'draw'"
            v-model="brushColor"
            class="chat-image-editor__color"
            type="color"
            :aria-label="t('chat_image_editor_color')"
          />
          <VSlider
            v-model="brushWidth"
            class="chat-image-editor__slider"
            min="2"
            max="18"
            step="1"
            hide-details
            density="compact"
          />
        </div>

        <div v-else-if="activeTool === 'blur'" class="chat-image-editor__option-row">
          <VTooltip location="top" :text="t('chat_image_editor_undo')">
            <template #activator="{ props }">
              <IconBtn
                v-bind="props"
                :disabled="!editor.canUndo.value"
                :aria-label="t('chat_image_editor_undo')"
                @click="editor.undo"
              >
                <VIcon size="20">tabler-arrow-back-up</VIcon>
              </IconBtn>
            </template>
          </VTooltip>
          <VSlider
            v-model="blurIntensity"
            class="chat-image-editor__slider"
            min="10"
            max="100"
            step="1"
            hide-details
            density="compact"
          />
          <span class="chat-image-editor__slider-value">{{ blurIntensity }}</span>
          <IconBtn
            :disabled="!canEditActivePhoto"
            :aria-label="t('delete')"
            @click="editor.removeSelectedObject"
          >
            <VIcon size="20">tabler-trash</VIcon>
          </IconBtn>
        </div>

        <div v-else-if="activeTool === 'text'" class="chat-image-editor__option-row">
          <VBtn
            size="small"
            variant="tonal"
            :disabled="!canEditActivePhoto"
            @click="handleAddText"
          >
            <VIcon start size="18">tabler-text-size</VIcon>
            {{ t('chat_image_editor_add_text') }}
          </VBtn>
          <VBtn
            size="small"
            variant="text"
            :disabled="!canEditActivePhoto"
            @click="editor.removeSelectedObject"
          >
            {{ t('delete') }}
          </VBtn>
        </div>

        <div v-else-if="activeTool === 'shape'" class="chat-image-editor__option-row">
          <input
            v-model="shapeColor"
            class="chat-image-editor__color"
            type="color"
            :aria-label="t('chat_image_editor_color')"
          />
          <VBtnToggle v-model="selectedShape" mandatory density="compact">
            <VBtn
              v-for="shape in shapeItems"
              :key="shape.value"
              :value="shape.value"
              size="small"
              :aria-label="shape.label"
            >
              <VIcon size="18">{{ shape.icon }}</VIcon>
            </VBtn>
          </VBtnToggle>
          <VBtn
            size="small"
            variant="tonal"
            :disabled="!canEditActivePhoto"
            @click="handleAddShape"
          >
            {{ t('add') }}
          </VBtn>
        </div>

        <div v-else-if="activeTool === 'emoji'" class="chat-image-editor__option-row">
          <VMenu
            v-model="isEmojiMenuOpen"
            :close-on-content-click="false"
            location="top"
          >
            <template #activator="{ props }">
              <VBtn v-bind="props" size="small" variant="tonal">
                <VIcon start size="18">tabler-mood-smile</VIcon>
                {{ t('chat_image_editor_add_emoji') }}
              </VBtn>
            </template>
            <div class="chat-image-editor__emoji-menu">
              <Picker
                :data="emojiIndex"
                :per-line="8"
                :show-preview="false"
                :show-search="true"
                :show-skin-tones="false"
                @select="handleEmojiSelect"
              />
            </div>
          </VMenu>
          <VBtn
            size="small"
            variant="text"
            :disabled="!canEditActivePhoto"
            @click="editor.removeSelectedObject"
          >
            {{ t('delete') }}
          </VBtn>
        </div>
      </section>

      <footer class="chat-image-editor__footer">
        <div class="chat-image-editor__thumbs">
          <button
            v-for="photo in photosModel"
            :key="photo.id"
            type="button"
            class="chat-image-editor__thumb"
            :class="{ 'is-active': photo.id === activePhotoId }"
            @click="setActivePhoto(photo.id)"
          >
            <VImg :src="photo.preview" :alt="photo.file.name" cover />
            <VIcon v-if="photo.edited" class="chat-image-editor__edited" size="14">
              tabler-check
            </VIcon>
            <IconBtn
              class="chat-image-editor__remove"
              size="x-small"
              :aria-label="t('delete')"
              @click.stop="removePhoto(photo.id)"
            >
              <VIcon size="14">tabler-x</VIcon>
            </IconBtn>
          </button>
        </div>

        <VTextarea
          v-model="captionModel"
          class="chat-image-editor__caption"
          variant="solo"
          density="comfortable"
          rows="1"
          auto-grow
          max-rows="3"
          hide-details
          :placeholder="t('write_your_message')"
        />
      </footer>
  </div>
</template>

<style scoped>
.chat-image-editor {
  position: absolute;
  z-index: 20;
  inset: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  grid-template-columns: minmax(0, 1fr);
  inline-size: 100%;
  block-size: 100%;
  min-block-size: 0;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.92);
}

.chat-image-editor__header {
  display: flex;
  align-items: center;
  gap: 14px;
  min-block-size: 64px;
  padding: 10px 18px;
  border-block-end: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
}

.chat-image-editor__title {
  display: flex;
  flex-direction: column;
  min-inline-size: 0;
  line-height: 1.25;
}

.chat-image-editor__title span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
}

.chat-image-editor__header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-inline-start: auto;
}

.chat-image-editor__stage {
  position: relative;
  display: grid;
  place-items: center;
  min-block-size: 0;
  padding: 16px;
  overflow: hidden;
  background: #f7f5f2;
}

.chat-image-editor__canvas-wrap {
  position: relative;
  display: inline-block;
  max-inline-size: 100%;
  max-block-size: 100%;
}

.chat-image-editor__canvas {
  display: block;
  max-inline-size: 100%;
  max-block-size: 100%;
  border-radius: 4px;
  background: #eef1f5;
  box-shadow: 0 12px 38px rgba(15, 23, 42, 0.16);
  touch-action: none;
}

.chat-image-editor__text-overlay {
  position: absolute;
  z-index: 2;
  min-inline-size: 84px;
  max-inline-size: 76%;
  min-block-size: 42px;
  padding: 0 8px;
  border: 1px dashed rgba(255, 255, 255, 0.78);
  border-radius: 4px;
  outline: 0;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.12);
  box-shadow: 0 2px 10px rgba(15, 23, 42, 0.18);
  color: #ffffff;
  cursor: move;
  font-family: Roboto, Arial, sans-serif;
  font-weight: 600;
  line-height: 1.2;
  resize: none;
  text-align: center;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
  transform: translate(-50%, -50%);
}

.chat-image-editor__text-overlay:focus {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(15, 23, 42, 0.18);
}

.chat-image-editor__shape-overlay {
  position: absolute;
  z-index: 2;
  border: 1px dashed rgba(var(--v-theme-primary), 0.74);
  cursor: move;
  touch-action: none;
}

.chat-image-editor__shape-overlay.is-line,
.chat-image-editor__shape-overlay.is-arrow {
  min-block-size: 24px;
}

.chat-image-editor__shape-svg {
  display: block;
  inline-size: 100%;
  block-size: 100%;
  overflow: visible;
  pointer-events: none;
}

.chat-image-editor__shape-svg rect,
.chat-image-editor__shape-svg ellipse,
.chat-image-editor__shape-svg line {
  fill: transparent;
  stroke: var(--shape-color);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 5;
  vector-effect: non-scaling-stroke;
}

.chat-image-editor__shape-svg polygon {
  fill: var(--shape-color);
  stroke: var(--shape-color);
  vector-effect: non-scaling-stroke;
}

.chat-image-editor__shape-resize {
  position: absolute;
  inset-block-end: -8px;
  inset-inline-end: -8px;
  inline-size: 16px;
  block-size: 16px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.22);
  cursor: nwse-resize;
  touch-action: none;
}

.chat-image-editor__shape-rotate-line {
  position: absolute;
  inset-block-start: -28px;
  inset-inline-start: 50%;
  inline-size: 1px;
  block-size: 28px;
  background: rgba(var(--v-theme-primary), 0.74);
  pointer-events: none;
}

.chat-image-editor__shape-rotate {
  position: absolute;
  z-index: 2;
  inset-block-start: -42px;
  inset-inline-start: 50%;
  display: grid;
  place-items: center;
  inline-size: 24px;
  block-size: 24px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.22);
  color: #ffffff;
  cursor: grab;
  transform: translateX(-50%);
  touch-action: none;
}

.chat-image-editor__shape-rotate:active {
  cursor: grabbing;
}

.chat-image-editor__blur-overlay {
  position: absolute;
  z-index: 3;
  border: 2px solid #2bb741;
  background:
    linear-gradient(45deg, rgba(0, 0, 0, 0.18) 25%, transparent 25% 50%, rgba(0, 0, 0, 0.18) 50% 75%, transparent 75%),
    rgba(120, 132, 95, 0.34);
  background-size: 18px 18px;
  backdrop-filter: blur(var(--blur-strength)) saturate(0.85);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  cursor: move;
  transform: translate(-50%, -50%);
  touch-action: none;
}

.chat-image-editor__blur-handle,
.chat-image-editor__blur-resize {
  position: absolute;
  inline-size: 10px;
  block-size: 10px;
  border: 2px solid rgba(45, 45, 45, 0.7);
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.22);
}

.chat-image-editor__blur-handle.is-1 {
  inset-block-start: -6px;
  inset-inline-start: -6px;
}

.chat-image-editor__blur-handle.is-2 {
  inset-block-start: -6px;
  inset-inline-start: 50%;
  transform: translateX(-50%);
}

.chat-image-editor__blur-handle.is-3 {
  inset-block-start: -6px;
  inset-inline-end: -6px;
}

.chat-image-editor__blur-handle.is-4 {
  inset-block-start: 50%;
  inset-inline-end: -6px;
  transform: translateY(-50%);
}

.chat-image-editor__blur-handle.is-5 {
  inset-block-end: -6px;
  inset-inline-end: -6px;
}

.chat-image-editor__blur-handle.is-6 {
  inset-block-end: -6px;
  inset-inline-start: 50%;
  transform: translateX(-50%);
}

.chat-image-editor__blur-handle.is-7 {
  inset-block-end: -6px;
  inset-inline-start: -6px;
}

.chat-image-editor__blur-handle.is-8 {
  inset-block-start: 50%;
  inset-inline-start: -6px;
  transform: translateY(-50%);
}

.chat-image-editor__blur-resize {
  inset-block-end: -8px;
  inset-inline-end: -8px;
  inline-size: 16px;
  block-size: 16px;
  border-color: #ffffff;
  background: #2bb741;
  cursor: nwse-resize;
  touch-action: none;
}

.chat-image-editor__emoji-overlay {
  position: absolute;
  z-index: 4;
  display: grid;
  place-items: center;
  border: 1px dashed rgba(var(--v-theme-primary), 0.82);
  border-radius: 8px;
  cursor: move;
  line-height: 1;
  transform: translate(-50%, -50%);
  touch-action: none;
  user-select: none;
}

.chat-image-editor__emoji-glyph {
  display: block;
  filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.32));
  line-height: 1;
  pointer-events: none;
}

.chat-image-editor__emoji-resize {
  position: absolute;
  inset-block-end: -8px;
  inset-inline-end: -8px;
  inline-size: 16px;
  block-size: 16px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary));
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.22);
  cursor: nwse-resize;
  touch-action: none;
}

.chat-image-editor__tools {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-block-size: 56px;
  padding: 8px 14px;
  overflow-x: auto;
  border-block-end: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
}

.chat-image-editor__tool-btn {
  color: rgba(var(--v-theme-on-surface), 0.64);
}

.chat-image-editor__tool-btn.is-active {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}

.chat-image-editor__options {
  min-block-size: 74px;
  padding: 10px 16px;
  overflow-x: auto;
  border-block-start: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
}

.chat-image-editor__option-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-block-size: 48px;
  justify-content: center;
}

.chat-image-editor__filters {
  display: flex;
  gap: 12px;
  min-block-size: 58px;
}

.chat-image-editor__filter {
  display: grid;
  gap: 4px;
  justify-items: center;
  min-inline-size: 58px;
  border: 0;
  color: rgba(var(--v-theme-on-surface), 0.7);
  background: transparent;
  cursor: pointer;
}

.chat-image-editor__filter:disabled {
  cursor: default;
  opacity: 0.5;
}

.chat-image-editor__filter.is-active {
  color: rgb(var(--v-theme-primary));
}

.chat-image-editor__filter-swatch {
  display: block;
  inline-size: 46px;
  block-size: 38px;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 6px;
}

.chat-image-editor__filter.is-active .chat-image-editor__filter-swatch {
  border-color: rgb(var(--v-theme-primary));
}

.filter-pop {
  filter: saturate(1.35) contrast(1.14) brightness(1.06);
}

.filter-grayscale {
  filter: grayscale(1);
}

.filter-cold {
  filter: saturate(1.08) sepia(0.08) hue-rotate(178deg);
}

.filter-chrome {
  filter: saturate(1.42) contrast(1.22) brightness(1.04);
}

.filter-film {
  filter: sepia(0.65) contrast(1.08);
}

.chat-image-editor__color {
  inline-size: 34px;
  block-size: 34px;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 50%;
  background: transparent;
}

.chat-image-editor__slider {
  max-inline-size: 220px;
}

.chat-image-editor__slider-value {
  min-inline-size: 28px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.86rem;
  text-align: center;
}

.chat-image-editor__emoji-menu {
  background: rgb(var(--v-theme-surface));
  border-radius: 6px;
  overflow: hidden;
}

.chat-image-editor__gif-preview,
.chat-image-editor__empty {
  display: grid;
  place-items: center;
  inline-size: min(720px, 100%);
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.chat-image-editor__footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 520px);
  gap: 14px;
  align-items: center;
  padding: 10px 18px 14px;
  border-block-start: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  background: rgb(var(--v-theme-surface));
}

.chat-image-editor__thumbs {
  display: flex;
  gap: 10px;
  min-inline-size: 0;
  overflow-x: auto;
  padding-block: 4px;
}

.chat-image-editor__thumb {
  position: relative;
  inline-size: 58px;
  block-size: 58px;
  flex: 0 0 58px;
  padding: 0;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  cursor: pointer;
}

.chat-image-editor__thumb.is-active {
  border-color: rgb(var(--v-theme-primary));
}

.chat-image-editor__edited {
  position: absolute;
  inset-block-end: 4px;
  inset-inline-start: 4px;
  display: grid;
  place-items: center;
  inline-size: 18px;
  block-size: 18px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
  color: white;
}

.chat-image-editor__remove {
  position: absolute;
  inset-block-start: 2px;
  inset-inline-end: 2px;
  background: rgba(15, 23, 42, 0.66);
  color: white;
}

.chat-image-editor__caption {
  min-inline-size: 0;
}

.chat-image-editor__caption :deep(.v-field) {
  border-radius: 28px;
}

@media (max-width: 780px) {
  .chat-image-editor {
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  }

  .chat-image-editor__header {
    padding-inline: 10px;
  }

  .chat-image-editor__header-actions {
    gap: 6px;
  }

  .chat-image-editor__tools {
    padding: 8px 10px;
  }

  .chat-image-editor__options {
    min-block-size: 66px;
    padding: 8px 10px;
  }

  .chat-image-editor__footer {
    grid-template-columns: 1fr;
    gap: 8px;
    padding: 8px 10px 10px;
  }

  .chat-image-editor__stage {
    padding: 10px;
  }
}
</style>
