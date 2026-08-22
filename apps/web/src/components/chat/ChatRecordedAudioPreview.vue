<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, useTemplateRef, watch } from 'vue';

interface Props {
  src: string;
  durationSeconds: number | null;
  viewOnce: boolean;
  canUseViewOnce: boolean;
  sending?: boolean;
}

const props = withDefaults(defineProps<Props>(), { sending: false });
const emit = defineEmits<{
  discard: [];
  send: [];
  'update:viewOnce': [value: boolean];
}>();

const audioPlayer = useTemplateRef<HTMLAudioElement>('audioPlayer');
const isPlaying = shallowRef(false);
const currentTime = shallowRef(0);
const detectedDuration = shallowRef<number | null>(null);

const duration = computed(() => detectedDuration.value ?? props.durationSeconds ?? 0);
const progress = computed(() =>
  duration.value > 0 ? (currentTime.value / duration.value) * 100 : 0
);

const formatTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60)
    .toString()
    .padStart(2, '0');
  return `${minutes}:${(safeSeconds % 60).toString().padStart(2, '0')}`;
};

const togglePlayback = (): void => {
  const player = audioPlayer.value;
  if (!player) return;
  if (player.paused) {
    player.play().catch(() => {
      isPlaying.value = false;
    });
    return;
  }
  player.pause();
};

const resetPlayer = (): void => {
  const player = audioPlayer.value;
  if (player) {
    player.pause();
    player.currentTime = 0;
  }
  isPlaying.value = false;
  currentTime.value = 0;
  detectedDuration.value = null;
};

const onLoadedMetadata = (): void => {
  const value = audioPlayer.value?.duration;
  detectedDuration.value =
    typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const onTimeUpdate = (): void => {
  currentTime.value = audioPlayer.value?.currentTime ?? 0;
};

watch(
  () => props.src,
  () => resetPlayer()
);

onBeforeUnmount(resetPlayer);
</script>

<template>
  <div class="recorded-audio-preview whats-composer">
    <audio
      ref="audioPlayer"
      :src="props.src"
      preload="metadata"
      @ended="isPlaying = false"
      @loadedmetadata="onLoadedMetadata"
      @pause="isPlaying = false"
      @play="isPlaying = true"
      @timeupdate="onTimeUpdate"
    />

    <VBtn
      icon
      variant="text"
      class="recorded-audio-preview__discard"
      aria-label="Descartar áudio gravado"
      :disabled="props.sending"
      @click="emit('discard')"
    >
      <VIcon size="20">tabler-trash</VIcon>
    </VBtn>

    <VBtn
      icon
      variant="tonal"
      color="primary"
      class="recorded-audio-preview__play"
      :aria-label="isPlaying ? 'Pausar áudio gravado' : 'Ouvir áudio gravado'"
      @click="togglePlayback"
    >
      <VIcon size="20">
        {{ isPlaying ? 'tabler-player-pause' : 'tabler-player-play' }}
      </VIcon>
    </VBtn>

    <div class="recorded-audio-preview__timeline" aria-hidden="true">
      <div
        class="recorded-audio-preview__progress"
        :style="{ width: `${progress}%` }"
      />
    </div>

    <span class="recorded-audio-preview__time">
      {{ formatTime(currentTime) }} / {{ formatTime(duration) }}
    </span>

    <VBtn
      v-if="props.canUseViewOnce"
      icon
      variant="text"
      class="recorded-audio-preview__view-once"
      :class="{ 'recorded-audio-preview__view-once--active': props.viewOnce }"
      :aria-label="props.viewOnce ? 'Desativar visualização única' : 'Ativar visualização única'"
      :disabled="props.sending"
      @click="emit('update:viewOnce', !props.viewOnce)"
    >
      <VIcon size="20">{{ props.viewOnce ? 'tabler-eye-off' : 'tabler-eye' }}</VIcon>
    </VBtn>

    <VBtn
      icon
      color="success"
      variant="flat"
      rounded="pill"
      class="recorded-audio-preview__send"
      aria-label="Enviar áudio gravado"
      :loading="props.sending"
      :disabled="props.sending"
      @click="emit('send')"
    >
      <VIcon size="20">tabler-send</VIcon>
    </VBtn>
  </div>
</template>

<style scoped>
.recorded-audio-preview {
  display: flex;
  align-items: center;
  gap: 10px;
  min-block-size: 56px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}

.recorded-audio-preview audio {
  display: none;
}

.recorded-audio-preview__discard,
.recorded-audio-preview__view-once {
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.recorded-audio-preview__play,
.recorded-audio-preview__send {
  flex: 0 0 auto;
}

.recorded-audio-preview__timeline {
  position: relative;
  block-size: 4px;
  min-inline-size: 48px;
  flex: 1 1 auto;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.14);
}

.recorded-audio-preview__progress {
  block-size: 100%;
  border-radius: inherit;
  background: rgb(var(--v-theme-success));
  transition: inline-size 100ms linear;
}

.recorded-audio-preview__time {
  min-inline-size: 76px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.recorded-audio-preview__view-once--active {
  color: rgb(var(--v-theme-primary));
}

@media (max-width: 600px) {
  .recorded-audio-preview {
    gap: 6px;
    padding-inline: 8px;
  }

  .recorded-audio-preview__time {
    min-inline-size: 64px;
    font-size: 0.6875rem;
  }
}
</style>
