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
    size: 24,
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

const strokeWidth = computed(() => (props.size <= 24 ? 2 : 2.25));
const center = computed(() => props.size / 2);
const radius = computed(() =>
  Math.max(0, (props.size - strokeWidth.value - 1) / 2)
);
const circumference = computed(() => 2 * Math.PI * radius.value);
const strokeDashoffset = computed(
  () =>
    circumference.value - (normalizedProgress.value / 100) * circumference.value
);
const ringTransform = computed(
  () => `rotate(-90 ${center.value} ${center.value})`
);
</script>

<template>
  <div
    class="upload-progress-badge"
    :class="{ 'upload-progress-badge--error': status === 'error' }"
    :style="badgeStyle"
    aria-live="polite"
  >
    <svg
      class="upload-progress-badge__ring"
      :width="size"
      :height="size"
      :viewBox="`0 0 ${size} ${size}`"
      aria-hidden="true"
    >
      <circle
        class="upload-progress-badge__track"
        :class="{ 'upload-progress-badge__track--error': status === 'error' }"
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke-width="strokeWidth"
      />
      <circle
        class="upload-progress-badge__value"
        :class="{ 'upload-progress-badge__value--error': status === 'error' }"
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke-width="strokeWidth"
        :stroke-dasharray="`${circumference} ${circumference}`"
        :stroke-dashoffset="status === 'error' ? 0 : strokeDashoffset"
        :transform="ringTransform"
      />
    </svg>
    <span v-if="status !== 'error'" class="upload-progress-badge__label">
      {{ normalizedProgress }}%
    </span>
    <VIcon v-else size="14" color="error">tabler-alert-circle</VIcon>
  </div>
</template>

<style scoped>
.upload-progress-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border-radius: 50%;
  background: rgba(var(--v-theme-surface), 0.95);
  box-shadow: 0 1px 5px rgba(var(--v-theme-on-surface), 0.12);
  color: rgb(var(--v-theme-primary));
  overflow: hidden;
  pointer-events: none;
}

.upload-progress-badge--error {
  background: rgba(var(--v-theme-surface), 0.96);
  color: rgb(var(--v-theme-error));
}

.upload-progress-badge__label {
  position: relative;
  z-index: 1;
  color: rgb(var(--v-theme-primary));
  font-size: 0.47rem;
  font-weight: 800;
  letter-spacing: 0;
  line-height: 1;
  text-align: center;
}

.upload-progress-badge--error .upload-progress-badge__label {
  color: rgb(var(--v-theme-error));
}

.upload-progress-badge__ring {
  position: absolute;
  inset: 0;
}

.upload-progress-badge__track,
.upload-progress-badge__value {
  fill: none;
}

.upload-progress-badge__track {
  stroke: rgba(var(--v-theme-primary), 0.18);
}

.upload-progress-badge__track--error {
  stroke: rgba(var(--v-theme-error), 0.2);
}

.upload-progress-badge__value {
  stroke: rgb(var(--v-theme-primary));
  stroke-linecap: round;
  transition: stroke-dashoffset 160ms ease;
}

.upload-progress-badge__value--error {
  stroke: rgb(var(--v-theme-error));
}
</style>
