<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import { publicApiOrigin } from '../apiPublicConfig';

interface Props {
  kind?: 'origin' | 'versioned' | 'openapi';
}

const props = withDefaults(defineProps<Props>(), {
  kind: 'versioned',
});

const copied = shallowRef(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;

const value = computed(() => {
  if (props.kind === 'origin') return publicApiOrigin;
  if (props.kind === 'openapi') return `${publicApiOrigin}/docs/openapi.json`;
  return `${publicApiOrigin}/v1`;
});

async function copyValue() {
  if (typeof navigator === 'undefined') return;

  await navigator.clipboard.writeText(value.value);
  copied.value = true;
  clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copied.value = false;
  }, 1800);
}

onBeforeUnmount(() => clearTimeout(resetTimer));
</script>

<template>
  <div class="api-base-url">
    <span class="api-base-url__value">{{ value }}</span>
    <button
      class="api-base-url__copy"
      type="button"
      :aria-label="copied ? 'URL copiada' : 'Copiar URL'"
      @click="copyValue"
    >
      {{ copied ? 'Copiado' : 'Copiar' }}
    </button>
  </div>
</template>

<style scoped>
.api-base-url {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 18px 0;
  padding: 10px 12px 10px 16px;
  border: 1px solid var(--uc-border-strong);
  border-radius: 12px;
  background: var(--uc-code-panel);
  box-shadow: inset 3px 0 0 var(--uc-mint);
}

.api-base-url__value {
  overflow-x: auto;
  color: var(--uc-code-text);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  white-space: nowrap;
}

.api-base-url__copy {
  flex: none;
  min-width: 72px;
  padding: 7px 12px;
  border: 1px solid color-mix(in srgb, var(--uc-mint) 48%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--uc-mint) 10%, transparent);
  color: var(--uc-copy-text);
  font-family: var(--vp-font-family-base);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition:
    transform 160ms ease,
    background 160ms ease;
}

.api-base-url__copy:hover {
  background: color-mix(in srgb, var(--uc-mint) 18%, transparent);
  transform: translateY(-1px);
}

.api-base-url__copy:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--uc-mint) 32%, transparent);
  outline-offset: 2px;
}
</style>
