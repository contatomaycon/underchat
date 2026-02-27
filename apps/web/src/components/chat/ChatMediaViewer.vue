<script lang="ts" setup>
import { computed, onUnmounted, ref, watch } from 'vue';

export type ChatViewerMediaKind = 'image' | 'video';

export interface ChatViewerMediaItem {
  src: string;
  caption?: string;
  downloadName?: string;
  kind: ChatViewerMediaKind;
}

interface DownloadPayload {
  item: ChatViewerMediaItem;
  index: number;
}

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    src?: string;
    caption?: string;
    downloadName?: string;
    kind?: ChatViewerMediaKind;
    items?: ChatViewerMediaItem[];
    initialIndex?: number;
  }>(),
  {
    src: '',
    caption: '',
    downloadName: '',
    kind: 'image',
    items: () => [],
    initialIndex: 0,
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  download: [payload?: DownloadPayload];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const normalizedItems = computed<ChatViewerMediaItem[]>(() => {
  const validItems = (props.items ?? []).filter(
    (item) => typeof item?.src === 'string' && item.src.length > 0
  );
  if (validItems.length > 0) {
    return validItems;
  }

  if (!props.src) {
    return [];
  }

  return [
    {
      src: props.src,
      caption: props.caption,
      downloadName: props.downloadName,
      kind: props.kind,
    },
  ];
});

const activeIndex = ref(0);

const clampIndex = (index: number): number => {
  const length = normalizedItems.value.length;
  if (length === 0) return 0;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
};

const currentItem = computed<ChatViewerMediaItem | null>(() => {
  const item = normalizedItems.value[activeIndex.value];
  return item ?? null;
});

const hasMultipleItems = computed(() => normalizedItems.value.length > 1);
const hasPreviousItem = computed(() => activeIndex.value > 0);
const hasNextItem = computed(
  () => activeIndex.value < normalizedItems.value.length - 1
);

const syncActiveIndex = () => {
  if (!isOpen.value) return;
  activeIndex.value = clampIndex(props.initialIndex ?? 0);
};

watch(
  () => [isOpen.value, normalizedItems.value.length, props.initialIndex],
  () => {
    if (!isOpen.value) return;
    syncActiveIndex();
  },
  { immediate: true }
);

const goToPrevious = () => {
  if (!hasPreviousItem.value) return;
  activeIndex.value = clampIndex(activeIndex.value - 1);
};

const goToNext = () => {
  if (!hasNextItem.value) return;
  activeIndex.value = clampIndex(activeIndex.value + 1);
};

const closeViewer = () => {
  isOpen.value = false;
};

const handleKeydown = (event: KeyboardEvent) => {
  if (!isOpen.value) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    closeViewer();
    return;
  }

  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    goToPrevious();
    return;
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault();
    goToNext();
  }
};

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', handleKeydown);
}

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeydown);
  }
});

const downloadViewerMedia = () => {
  if (!currentItem.value) return;

  emit('download', {
    item: currentItem.value,
    index: activeIndex.value,
  });
};
</script>

<template>
  <VDialog
    :model-value="isOpen"
    fullscreen
    scrim="rgba(0,0,0,.9)"
    :scrollable="false"
    @update:model-value="isOpen = $event"
  >
    <div class="viewer-wrap" @click="closeViewer">
      <div class="viewer-box" @click.stop>
        <div class="viewer-media-container">
          <img
            v-if="currentItem?.kind === 'image'"
            :src="currentItem.src"
            alt=""
            class="viewer-img"
            loading="eager"
            decoding="async"
          />
          <video
            v-else-if="currentItem?.kind === 'video'"
            :src="currentItem.src"
            class="viewer-video"
            controls
            playsinline
          >
            <track kind="captions" />
          </video>

          <VBtn
            v-if="hasMultipleItems"
            class="viewer-nav viewer-nav--prev"
            icon
            size="44"
            variant="flat"
            :disabled="!hasPreviousItem"
            @click.stop="goToPrevious"
          >
            <VIcon size="24">tabler-chevron-left</VIcon>
          </VBtn>

          <VBtn
            v-if="hasMultipleItems"
            class="viewer-nav viewer-nav--next"
            icon
            size="44"
            variant="flat"
            :disabled="!hasNextItem"
            @click.stop="goToNext"
          >
            <VIcon size="24">tabler-chevron-right</VIcon>
          </VBtn>

          <div v-if="hasMultipleItems" class="viewer-counter">
            {{ activeIndex + 1 }} de {{ normalizedItems.length }}
          </div>

          <div class="viewer-actions">
            <VBtn
              v-if="currentItem?.src"
              class="viewer-download"
              icon
              size="36"
              variant="text"
              @click.stop="downloadViewerMedia"
            >
              <VIcon size="20">tabler-download</VIcon>
            </VBtn>
            <VBtn
              class="viewer-close"
              icon
              size="36"
              variant="text"
              @click="closeViewer"
            >
              <VIcon size="20">tabler-x</VIcon>
            </VBtn>
          </div>
        </div>

        <div v-if="currentItem?.caption" class="viewer-caption">
          {{ currentItem.caption }}
        </div>
      </div>
    </div>
  </VDialog>
</template>

<style lang="scss" scoped>
.viewer-wrap {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: transparent;
  padding: 16px;
  overflow: hidden;
}

.viewer-box {
  margin: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  max-width: 90vw;
  max-height: 90vh;
}

.viewer-media-container {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  max-width: 100%;
  max-height: 100%;
}

.viewer-img {
  display: block;
  width: auto;
  height: auto;
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 12px;
}

.viewer-video {
  display: block;
  max-width: 90vw;
  max-height: 85vh;
  border-radius: 12px;
  background: #000;
}

.viewer-actions {
  position: absolute;
  top: 16px;
  right: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 10;
}

.viewer-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  color: white !important;
  background: rgba(0, 0, 0, 0.45) !important;

  &:hover {
    background: rgba(0, 0, 0, 0.65) !important;
  }
}

.viewer-nav--prev {
  left: 20px;
}

.viewer-nav--next {
  right: 20px;
}

.viewer-counter {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  color: white;
  font-size: 0.85rem;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.45);
}

.viewer-close,
.viewer-download {
  color: white !important;
  background: rgba(0, 0, 0, 0.5) !important;
  border-radius: 50%;
  min-width: 36px;
  height: 36px;

  &:hover {
    background: rgba(0, 0, 0, 0.7) !important;
  }
}

.viewer-caption {
  color: white;
  text-align: center;
  margin: 12px;
  max-width: min(90vw, 980px);
  white-space: pre-line;
}
</style>
