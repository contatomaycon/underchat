<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    progress?: number;
    status?: 'uploading' | 'error';
    size?: number;
  }>(),
  {
    progress: 0,
    status: 'uploading',
    size: 38,
  }
);

const normalizedProgress = computed(() => {
  if (!Number.isFinite(props.progress)) return 0;
  return Math.max(0, Math.min(99, Math.round(props.progress)));
});

const badgeStyle = computed(() => ({
  inlineSize: `${props.size}px`,
  blockSize: `${props.size}px`,
}));
</script>

<template>
  <div
    class="upload-progress-badge"
    :class="{ 'upload-progress-badge--error': status === 'error' }"
    :style="badgeStyle"
    aria-live="polite"
  >
    <VProgressCircular
      v-if="status !== 'error'"
      :model-value="normalizedProgress"
      :size="size"
      :width="3"
      color="primary"
      bg-color="rgba(255, 255, 255, 0.42)"
    >
      <span class="upload-progress-badge__label">
        {{ normalizedProgress }}%
      </span>
    </VProgressCircular>
    <VIcon v-else size="18" color="white">tabler-alert-circle</VIcon>
  </div>
</template>

<style scoped>
.upload-progress-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 50%;
  background: rgba(47, 43, 61, 0.72);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  color: #fff;
  pointer-events: none;
}

.upload-progress-badge--error {
  background: rgb(var(--v-theme-error));
}

.upload-progress-badge__label {
  color: #fff;
  font-size: 0.625rem;
  font-weight: 800;
  line-height: 1;
  text-align: center;
}
</style>
