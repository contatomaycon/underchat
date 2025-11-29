<script lang="ts" setup>
import { computed } from 'vue';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';

const props = defineProps<{
  preview: ViewLinkPreviewResponse | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

const previewDomain = computed(() => {
  const u =
    props.preview?.['canonical-url'] || props.preview?.['matched-text'] || '';
  if (!u) return '';
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
});

const previewHref = computed(() => {
  return (
    props.preview?.['canonical-url'] || props.preview?.['matched-text'] || ''
  );
});

const previewImage = computed(() => {
  const p = props.preview;
  if (!p) {
    return null;
  }
  const cand =
    p.highQualityThumbnail || p.originalThumbnailUrl || p.jpegThumbnail || '';
  if (!cand) return null;
  if (cand.startsWith('http')) return cand;
  return `data:image/jpeg;base64,${cand}`;
});
</script>

<template>
  <Transition name="fade">
    <div v-if="preview" class="mx-5 mt-3">
      <VCard class="link-preview-card">
        <VBtn
          class="link-preview-close"
          icon
          size="24"
          variant="text"
          @click="$emit('close')"
        >
          <VIcon size="18" icon="tabler-x" />
        </VBtn>
        <div class="d-flex gap-3">
          <VAvatar size="56" :rounded="8" variant="tonal">
            <VImg v-if="previewImage" :src="previewImage" />
          </VAvatar>
          <div class="flex-grow-1 overflow-hidden">
            <div class="text-caption text-medium-emphasis">
              {{ previewDomain }}
            </div>
            <div class="text-subtitle-1 font-weight-medium text-truncate">
              {{ preview?.title }}
            </div>
            <div class="text-body-2 text-medium-emphasis two-line-ellipsis">
              {{ preview?.description }}
            </div>
            <div class="mt-2">
              <a
                v-if="previewHref"
                :href="previewHref"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary text-body-2"
              >
                {{ previewHref }}
              </a>
            </div>
          </div>
        </div>
      </VCard>
    </div>
  </Transition>
</template>

<style lang="scss" scoped>
.link-preview-card {
  position: relative;
  padding: 14px;
  margin-bottom: 0.5rem;
}

.link-preview-close {
  position: absolute;
  top: 6px;
  right: 6px;
  min-width: 28px !important;
  width: 28px !important;
  height: 28px !important;
}

.two-line-ellipsis {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.18s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
