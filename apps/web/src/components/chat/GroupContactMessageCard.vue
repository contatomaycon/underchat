<template>
  <div
    class="group-contact-card"
    :class="{
      'group-contact-card--left': align === 'left',
      'group-contact-card--right': align === 'right',
      'group-contact-card--single': !isGroup,
    }"
    role="button"
    tabindex="0"
    @click="$emit('toggle')"
  >
    <div class="group-contact-card__body">
      <div class="group-contact-card__left">
        <VAvatar
          v-if="!isGroup"
          size="42"
          class="group-contact-card__photo"
          :variant="!photo ? 'tonal' : undefined"
          :color="!photo ? 'primary' : undefined"
        >
          <VImg v-if="photo" :src="photo" :alt="title" />
          <VIcon v-else size="20">tabler-user</VIcon>
        </VAvatar>
        <div v-else class="group-contact-card__icon">
          <svg
            class="group-contact-card__icon-svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              fill="currentColor"
              d="M16 11c1.66 0 3-1.34 3-3S17.66 5 16 5s-3 1.34-3 3s1.34 3 3 3Zm-8 0c1.66 0 3-1.34 3-3S9.66 5 8 5S5 6.34 5 8s1.34 3 3 3Zm0 2c-2.33 0-7 1.17-7 3.5V20h14v-3.5C15 14.17 10.33 13 8 13Zm8 0c-.29 0-.62.02-.97.05c1.16.84 1.97 1.96 1.97 3.45V20h7v-3.5c0-2.33-4.67-3.5-7-3.5Z"
            />
          </svg>
        </div>
      </div>

      <div class="group-contact-card__content">
        <div class="group-contact-card__title-row">
          <div class="group-contact-card__title">
            {{ title }}
          </div>
        </div>

        <div v-if="showMeta && time" class="group-contact-card__meta">
          <div class="group-contact-card__time">{{ time }}</div>
          <VIcon
            v-if="align === 'right'"
            class="group-contact-card__checks"
            size="16"
            :color="seen ? 'primary' : undefined"
          >
            tabler-checks
          </VIcon>
        </div>
      </div>
    </div>

    <button
      v-if="isGroup"
      type="button"
      class="group-contact-card__action"
      @click.stop="$emit('view-all')"
    >
      Ver todos
    </button>
  </div>
</template>

<script lang="ts" setup>
withDefaults(
  defineProps<{
    title: string;
    time?: string | null;
    seen?: boolean;
    align?: 'left' | 'right';
    isGroup?: boolean;
    photo?: string | null;
    showMeta?: boolean;
  }>(),
  {
    time: null,
    seen: false,
    align: 'left',
    isGroup: false,
    photo: null,
    showMeta: true,
  }
);

defineEmits<{
  (e: 'toggle'): void;
  (e: 'view-all'): void;
}>();
</script>

<style scoped lang="scss">
.group-contact-card {
  width: 380px;
  max-width: min(380px, 88vw);
  border-end-end-radius: 6px;
  border-end-start-radius: 6px;
  overflow: hidden;
  background: #fff;
  box-shadow:
    0 10px 26px rgba(16, 24, 40, 0.08),
    0 2px 8px rgba(16, 24, 40, 0.06);
}

.group-contact-card--left {
  border-start-end-radius: 6px;
  border-start-start-radius: 0;
}

.group-contact-card--right {
  border-start-start-radius: 6px;
  border-start-end-radius: 0;
}

.group-contact-card__body {
  display: flex;
  gap: 14px;
  padding: 18px 18px 16px 18px;
  min-height: 80px;
}

.group-contact-card--single .group-contact-card__body {
  padding-bottom: 18px;
}

.group-contact-card__left {
  display: flex;
  align-items: flex-start;
  padding-top: 2px;
}

.group-contact-card__photo {
  flex-shrink: 0;
}

.group-contact-card__icon {
  width: 42px;
  height: 42px;
  border-radius: 999px;
  background: rgba(59, 130, 246, 0.16);
  display: grid;
  place-items: center;
  color: rgba(37, 99, 235, 0.9);
  flex-shrink: 0;
}

.group-contact-card__icon-svg {
  display: block;
}

.group-contact-card__content {
  flex: 1 1 auto;
  min-width: 0;
}

.group-contact-card__title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.group-contact-card__title {
  font-family:
    ui-sans-serif,
    system-ui,
    -apple-system,
    Segoe UI,
    Roboto,
    Arial,
    'Noto Sans',
    'Apple Color Emoji',
    'Segoe UI Emoji';
  font-weight: 500;
  font-size: 0.95rem;
  color: rgba(17, 24, 39, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.group-contact-card__meta {
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
}

.group-contact-card__time {
  font-size: 0.75rem;
  color: rgba(107, 114, 128, 0.85);
  letter-spacing: 0.2px;
}

.group-contact-card__checks {
  opacity: 0.95;
}

.group-contact-card__action {
  width: 100%;
  border: 0;
  background: #fff;
  padding: 8px 16px;
  font-weight: 500;
  font-size: 0.9rem;
  color: rgba(37, 99, 235, 0.9);
  cursor: pointer;
  border-top: 1px solid rgba(17, 24, 39, 0.08);
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  min-height: 44px;
}

.group-contact-card__action:hover {
  background: rgba(59, 130, 246, 0.06);
}

.group-contact-card__action:active {
  background: rgba(59, 130, 246, 0.1);
}
</style>
