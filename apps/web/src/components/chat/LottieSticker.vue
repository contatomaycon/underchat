<script lang="ts" setup>
import JSZip from 'jszip';
import lottie, { AnimationItem } from 'lottie-web/build/player/lottie_light';
import { onMounted, onUnmounted, ref, watch } from 'vue';

interface Props {
  src: string;
}

const props = defineProps<Props>();

const containerRef = ref<HTMLElement | null>(null);
const hasError = ref(false);
let animation: AnimationItem | null = null;

const animationJsonCache = new Map<string, string>();

const cloneAnimationData = (json: string): Record<string, unknown> => {
  return JSON.parse(json) as Record<string, unknown>;
};

const resolveAnimationJson = async (src: string): Promise<string> => {
  const cached = animationJsonCache.get(src);
  if (cached) return cached;

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch sticker: ${response.status}`);
  }

  const zipData = await response.arrayBuffer();
  const zip = await JSZip.loadAsync(zipData);

  const fallbackEntries = zip.filter(
    (_, file) =>
      !file.dir &&
      file.name.endsWith('.json') &&
      !file.name.endsWith('.trust_token') &&
      !file.name.endsWith('.overridden_metadata')
  );
  const animationEntry =
    zip.file('animation/animation.json') ?? fallbackEntries[0];

  if (!animationEntry) {
    throw new Error('Animation JSON not found in sticker payload');
  }

  const json = await animationEntry.async('string');
  animationJsonCache.set(src, json);
  return json;
};

const destroyAnimation = (): void => {
  if (!animation) return;
  animation.destroy();
  animation = null;
};

const loadAnimation = async (src: string): Promise<void> => {
  if (!src || !containerRef.value) return;

  destroyAnimation();
  hasError.value = false;

  try {
    const animationJson = await resolveAnimationJson(src);
    if (!containerRef.value) return;

    animation = lottie.loadAnimation({
      container: containerRef.value,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      animationData: cloneAnimationData(animationJson),
      rendererSettings: {
        preserveAspectRatio: 'xMidYMid meet',
      },
    });
  } catch {
    hasError.value = true;
  }
};

watch(
  () => props.src,
  (next) => {
    void loadAnimation(next);
  },
  { immediate: true }
);

onMounted(() => {
  void loadAnimation(props.src);
});

onUnmounted(() => {
  destroyAnimation();
});
</script>

<template>
  <div class="lottie-sticker">
    <div ref="containerRef" class="lottie-sticker-canvas" />
    <div v-if="hasError" class="lottie-sticker-fallback">
      <VIcon size="20">tabler-file-description</VIcon>
    </div>
  </div>
</template>

<style scoped lang="scss">
.lottie-sticker {
  position: relative;
  inline-size: 100%;
  block-size: 100%;
}

.lottie-sticker-canvas {
  inline-size: 100%;
  block-size: 100%;
}

.lottie-sticker-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgba(var(--v-theme-on-surface), 0.72);
}
</style>
