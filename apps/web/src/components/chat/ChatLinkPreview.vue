<script lang="ts" setup>
import { computed } from 'vue';
import { ViewLinkPreviewResponse } from '@core/schema/chat/viewLinkPreview/response.schema';

const props = defineProps<{
  preview: ViewLinkPreviewResponse | null;
  loading?: boolean;
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
    <div v-if="preview || (loading && !preview)" class="mx-5 mt-3">
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
          <VAvatar v-if="!loading" size="56" :rounded="8" variant="tonal">
            <VImg v-if="previewImage" :src="previewImage" />
          </VAvatar>
          <VSkeletonLoader
            v-else
            type="avatar"
            width="56"
            height="56"
            class="link-preview-skeleton-avatar"
          />
          <div class="flex-grow-1 overflow-hidden">
            <div v-if="!loading" class="text-caption text-medium-emphasis">
              {{ previewDomain }}
            </div>
            <VSkeletonLoader
              v-else
              type="text"
              width="120"
              height="12"
              class="mb-2"
            />
            <div
              v-if="!loading"
              class="text-subtitle-1 font-weight-medium text-truncate"
            >
              {{ preview?.title }}
            </div>
            <VSkeletonLoader
              v-else
              type="text"
              width="80%"
              height="16"
              class="mb-2"
            />
            <div
              v-if="!loading"
              class="text-body-2 text-medium-emphasis two-line-ellipsis"
            >
              {{ preview?.description }}
            </div>
            <template v-else>
              <VSkeletonLoader
                type="text"
                width="100%"
                height="14"
                class="mb-1"
              />
              <VSkeletonLoader
                type="text"
                width="90%"
                height="14"
                class="mb-2"
              />
            </template>
            <div v-if="!loading" class="mt-2">
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
            <VSkeletonLoader
              v-else
              type="text"
              width="70%"
              height="14"
              class="mt-2"
            />
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

.link-preview-skeleton-avatar {
  border-radius: 8px;
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
