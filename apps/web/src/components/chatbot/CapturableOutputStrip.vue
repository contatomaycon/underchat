<script setup lang="ts">
import { onUnmounted, shallowRef } from 'vue';

interface Props {
  title: string;
  description: string;
  tags: readonly string[];
  copyLabel: string;
  copiedLabel: string;
}

const props = defineProps<Props>();
const copiedTag = shallowRef<string | null>(null);
let copiedTimer: ReturnType<typeof setTimeout> | null = null;

const copyTag = async (tag: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(tag);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = tag;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  copiedTag.value = tag;
  if (copiedTimer) clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedTag.value = null;
    copiedTimer = null;
  }, 1_600);
};

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <section class="capturable-output" :aria-label="props.title">
    <span class="capturable-output__icon" aria-hidden="true">
      <VIcon icon="tabler-braces" size="16" />
    </span>

    <div class="capturable-output__content">
      <div class="capturable-output__heading">
        <strong>{{ props.title }}</strong>
        <span>{{ props.description }}</span>
      </div>

      <div class="capturable-output__tags">
        <span
          v-for="tag in props.tags"
          :key="tag"
          class="capturable-output__tag"
        >
          <code>{{ tag }}</code>
          <button
            type="button"
            class="capturable-output__copy nodrag nopan"
            :class="{ 'capturable-output__copy--done': copiedTag === tag }"
            :aria-label="
              copiedTag === tag ? props.copiedLabel : props.copyLabel
            "
            :title="copiedTag === tag ? props.copiedLabel : props.copyLabel"
            @click.stop="copyTag(tag)"
          >
            <VIcon
              :icon="copiedTag === tag ? 'tabler-check' : 'tabler-copy'"
              size="14"
            />
          </button>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.capturable-output {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  padding: 8px;
  border: 1px solid rgba(var(--v-theme-info), 0.2);
  border-radius: 9px;
  background:
    linear-gradient(105deg, rgba(var(--v-theme-info), 0.06), transparent 72%),
    rgb(var(--v-theme-surface));
}

.capturable-output__icon {
  display: grid;
  block-size: 30px;
  inline-size: 30px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-info), 0.18);
  border-radius: 7px;
  background: rgba(var(--v-theme-info), 0.1);
  color: rgb(var(--v-theme-info));
}

.capturable-output__content,
.capturable-output__heading {
  display: grid;
  min-inline-size: 0;
}

.capturable-output__heading {
  gap: 1px;
}

.capturable-output__heading strong {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.65625rem;
  font-weight: 750;
  line-height: 1.25;
}

.capturable-output__heading span {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.5625rem;
  line-height: 1.3;
}

.capturable-output__tags {
  display: flex;
  gap: 5px;
  margin-block-start: 6px;
  overflow-x: auto;
  scrollbar-width: thin;
}

.capturable-output__tag {
  display: inline-flex;
  min-inline-size: 0;
  flex: 0 0 auto;
  align-items: center;
  gap: 3px;
  padding-inline-start: 7px;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 6px;
  background: rgba(var(--v-theme-primary), 0.055);
  color: rgb(var(--v-theme-primary));
}

.capturable-output__tag code {
  font-family: 'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace;
  font-size: 0.5625rem;
  font-weight: 700;
  white-space: nowrap;
}

.capturable-output__copy {
  display: grid;
  block-size: 26px;
  inline-size: 26px;
  min-inline-size: 26px;
  appearance: none;
  place-items: center;
  border: 0;
  border-inline-start: 1px solid rgba(var(--v-theme-primary), 0.13);
  border-radius: 0 5px 5px 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition:
    background-color 140ms ease,
    color 140ms ease;
}

.capturable-output__copy:hover {
  background: rgba(var(--v-theme-primary), 0.11);
}

.capturable-output__copy:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.52);
  outline-offset: -2px;
}

.capturable-output__copy--done {
  color: rgb(var(--v-theme-success));
}
</style>
