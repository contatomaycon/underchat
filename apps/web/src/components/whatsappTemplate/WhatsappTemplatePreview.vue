<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { WhatsappTemplateComponent } from '@core/schema/worker/whatsappOfficialTemplate';
import type { HeaderFormat, MediaAttachmentPreview } from './types';

const props = defineProps<{
  components: WhatsappTemplateComponent[];
  headerFormat?: HeaderFormat;
  mediaAttachment?: MediaAttachmentPreview | null;
}>();

const { t } = useI18n();
const allOptionsOpen = shallowRef(false);

const header = computed(() =>
  props.components.find((component) => component.type === 'HEADER')
);
const body = computed(() =>
  props.components.find((component) => component.type === 'BODY')
);
const footer = computed(() =>
  props.components.find((component) => component.type === 'FOOTER')
);
const buttons = computed(() => {
  const buttonComponent = props.components.find(
    (component) => component.type === 'BUTTONS'
  );
  return Array.isArray(buttonComponent?.buttons)
    ? (buttonComponent.buttons as Record<string, unknown>[])
    : [];
});

const headerFormat = computed(() =>
  String(props.headerFormat ?? header.value?.format ?? 'TEXT').toUpperCase()
);
const headerText = computed(() => String(header.value?.text ?? ''));
const bodyText = computed(() =>
  String(body.value?.text || t('whatsapp_template_default_body'))
);
const footerText = computed(() => String(footer.value?.text ?? ''));
const mediaAttachment = computed(() => props.mediaAttachment ?? null);
const hasFilledMediaHeader = computed(
  () =>
    Boolean(mediaAttachment.value?.url) &&
    ['IMAGE', 'VIDEO'].includes(mediaAttachment.value?.format ?? '')
);

const mediaHeader = computed(() => {
  const format = headerFormat.value;
  if (!['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) return null;

  const mediaMap: Record<string, { icon: string; label: string }> = {
    IMAGE: { icon: 'tabler-photo', label: t('whatsapp_template_header_image') },
    VIDEO: {
      icon: 'tabler-player-play',
      label: t('whatsapp_template_header_video'),
    },
    DOCUMENT: {
      icon: 'tabler-file-text',
      label: t('whatsapp_template_header_document'),
    },
  };

  return mediaMap[format];
});

const isLocationHeader = computed(() => headerFormat.value === 'LOCATION');
const locationNameSample = computed(
  () => `{{${t('whatsapp_template_location_name_sample')}}}`
);
const locationAddressSample = computed(
  () => `{{${t('whatsapp_template_location_address_sample')}}}`
);

const visibleButtons = computed(() =>
  buttons.value.length > 3
    ? buttons.value.slice(0, 2)
    : buttons.value.slice(0, 3)
);
const showMoreButton = computed(() => buttons.value.length > 3);
const canOpenAllOptions = computed(() => buttons.value.length > 0);
const actionButtons = computed(() =>
  buttons.value.filter((button) => String(button.type ?? '') !== 'QUICK_REPLY')
);
const quickReplyButtons = computed(() =>
  buttons.value.filter((button) => String(button.type ?? '') === 'QUICK_REPLY')
);
const hasGroupedOptionsDivider = computed(
  () => actionButtons.value.length > 0 && quickReplyButtons.value.length > 0
);

const buttonIcon = (button: Record<string, unknown>) => {
  const type = String(button.type ?? '');
  if (type === 'URL') return 'tabler-external-link';
  if (type === 'PHONE_NUMBER') return 'tabler-phone';
  if (type === 'VOICE_CALL') return 'tabler-phone-call';
  if (type === 'COPY_CODE') return 'tabler-copy';
  return 'tabler-arrow-back-up';
};

const buttonText = (button: Record<string, unknown>) => {
  const type = String(button.type ?? '');
  if (type === 'COPY_CODE') {
    return t('whatsapp_template_button_default_copy_code');
  }

  return String(button.text ?? button.type ?? t('whatsapp_template_button'));
};

const openAllOptions = () => {
  if (!canOpenAllOptions.value) return;
  allOptionsOpen.value = true;
};

const toggleAllOptions = () => {
  if (!canOpenAllOptions.value) return;
  allOptionsOpen.value = !allOptionsOpen.value;
};

watch(canOpenAllOptions, (canOpen) => {
  if (!canOpen) allOptionsOpen.value = false;
});
</script>

<template>
  <aside class="template-preview">
    <div class="template-preview__title-row">
      <div class="template-preview__title">
        {{ t('whatsapp_template_preview_title') }}
      </div>
      <VBtn
        v-if="buttons.length"
        icon
        variant="outlined"
        size="small"
        :aria-label="
          allOptionsOpen ? t('close') : t('whatsapp_template_preview_play')
        "
        @click="toggleAllOptions"
      >
        <VIcon
          :icon="allOptionsOpen ? 'tabler-x' : 'tabler-player-play-filled'"
          size="16"
        />
      </VBtn>
    </div>
    <div
      class="template-preview__phone"
      :class="{ 'template-preview__phone--options-open': allOptionsOpen }"
    >
      <div class="template-preview__bubble">
        <div
          v-if="mediaHeader"
          class="template-preview__media-header"
          :class="{
            'template-preview__media-header--filled': hasFilledMediaHeader,
          }"
        >
          <img
            v-if="mediaAttachment?.format === 'IMAGE' && mediaAttachment.url"
            class="template-preview__media-image"
            :src="mediaAttachment.url"
            :alt="mediaAttachment.name"
          />
          <video
            v-else-if="
              mediaAttachment?.format === 'VIDEO' && mediaAttachment.url
            "
            class="template-preview__media-video"
            :src="mediaAttachment.url"
            muted
            playsinline
          />
          <div
            v-else-if="
              mediaAttachment?.format === 'DOCUMENT' && mediaAttachment.name
            "
            class="template-preview__media-document"
          >
            <VIcon icon="tabler-file-text" size="26" />
            <span>{{ mediaAttachment.name }}</span>
          </div>
          <template v-else>
            <VIcon :icon="mediaHeader.icon" size="34" />
            <span>{{ mediaHeader.label }}</span>
          </template>
        </div>
        <div
          v-else-if="isLocationHeader"
          class="template-preview__location-header"
        >
          <div class="template-preview__location-map">
            <VIcon icon="tabler-map-pin" size="58" />
          </div>
          <div class="template-preview__location-copy">
            <strong>{{ locationNameSample }}</strong>
            <span>{{ locationAddressSample }}</span>
          </div>
        </div>
        <div v-else-if="headerText" class="template-preview__text-header">
          {{ headerText }}
        </div>
        <div class="template-preview__body">
          {{ bodyText }}
        </div>
        <div v-if="footerText" class="template-preview__footer">
          {{ footerText }}
        </div>
        <div class="template-preview__time">
          {{ t('whatsapp_template_preview_time') }}
        </div>
        <div v-if="buttons.length" class="template-preview__buttons">
          <button
            v-for="(button, index) in visibleButtons"
            :key="`${button.type}-${index}`"
            class="template-preview__button"
            type="button"
          >
            <VIcon :icon="buttonIcon(button)" size="16" />
            <span>{{ buttonText(button) }}</span>
          </button>
          <button
            v-if="showMoreButton"
            class="template-preview__button"
            type="button"
            @click="openAllOptions"
          >
            <VIcon icon="tabler-list" size="16" />
            <span>{{ t('whatsapp_template_view_all_options') }}</span>
          </button>
        </div>
      </div>
      <div
        v-if="allOptionsOpen"
        class="template-preview__options-scrim"
        @click="allOptionsOpen = false"
      />
      <div v-if="allOptionsOpen" class="template-preview__options-sheet">
        <div class="template-preview__options-handle" />
        <div class="template-preview__options-header">
          <button
            class="template-preview__options-close"
            type="button"
            :aria-label="t('close')"
            @click="allOptionsOpen = false"
          >
            <VIcon icon="tabler-x" size="18" />
          </button>
          <strong>{{ t('whatsapp_template_all_options_title') }}</strong>
          <span class="template-preview__options-spacer" />
        </div>
        <div class="template-preview__options-list">
          <button
            v-for="(button, index) in actionButtons"
            :key="`all-action-${button.type}-${index}`"
            class="template-preview__option-item"
            type="button"
          >
            <VIcon :icon="buttonIcon(button)" size="17" />
            <span>{{ buttonText(button) }}</span>
          </button>
          <VDivider
            v-if="hasGroupedOptionsDivider"
            class="template-preview__options-divider"
          />
          <button
            v-for="(button, index) in quickReplyButtons"
            :key="`all-reply-${button.type}-${index}`"
            class="template-preview__option-item"
            type="button"
          >
            <VIcon :icon="buttonIcon(button)" size="17" />
            <span>{{ buttonText(button) }}</span>
          </button>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.template-preview {
  position: sticky;
  inset-block-start: 84px;
  align-self: start;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
}

.template-preview__title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-block-size: 56px;
  padding: 12px 16px;
  border-block-end: 1px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
}

.template-preview__title {
  font-weight: 700;
}

.template-preview__phone {
  position: relative;
  min-block-size: 360px;
  overflow: hidden;
  padding: 18px;
  background-color: #f4efe7;
  background-image:
    radial-gradient(rgba(80, 72, 62, 0.06) 1px, transparent 1px),
    radial-gradient(rgba(80, 72, 62, 0.04) 1px, transparent 1px);
  background-position:
    0 0,
    9px 9px;
  background-size: 18px 18px;
}

.template-preview__bubble {
  position: relative;
  inline-size: min(100%, 290px);
  overflow: hidden;
  border-radius: 8px;
  background: white;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.12);
}

.template-preview__media-header {
  display: grid;
  place-items: center;
  min-block-size: 104px;
  overflow: hidden;
  padding: 12px;
  background: #eef2f6;
  color: #64748b;
  font-weight: 600;
  gap: 6px;
}

.template-preview__media-header--filled {
  min-block-size: 0;
  padding: 0;
}

.template-preview__media-image,
.template-preview__media-video {
  display: block;
  inline-size: 100%;
  block-size: 132px;
  object-fit: cover;
}

.template-preview__media-document {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  inline-size: 100%;
  gap: 8px;
  padding: 10px;
}

.template-preview__media-document span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-preview__location-header {
  overflow: hidden;
  margin: 10px 10px 0;
  border-radius: 8px;
  background: #cfd4d9;
}

.template-preview__location-map {
  display: grid;
  place-items: center;
  min-block-size: 108px;
  background: #b5bdc1;
  color: white;
}

.template-preview__location-copy {
  padding: 8px 10px;
  color: #111827;
  line-height: 1.25;
}

.template-preview__location-copy strong,
.template-preview__location-copy span {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-preview__location-copy span {
  font-size: 0.8rem;
}

.template-preview__text-header {
  padding: 12px 12px 0;
  color: #111827;
  font-weight: 700;
  white-space: pre-wrap;
}

.template-preview__body {
  padding: 10px 12px 4px;
  color: #111827;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.template-preview__footer {
  padding: 0 12px 6px;
  color: #64748b;
  font-size: 0.8rem;
}

.template-preview__time {
  padding: 0 12px 8px;
  color: #64748b;
  font-size: 0.72rem;
  text-align: end;
}

.template-preview__buttons {
  border-block-start: 1px solid #e5e7eb;
}

.template-preview__button {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: 100%;
  min-block-size: 42px;
  gap: 6px;
  border: 0;
  border-block-end: 1px solid #e5e7eb;
  background: white;
  color: #09846c;
  cursor: default;
  font-weight: 700;
}

.template-preview__button:last-child {
  border-block-end: 0;
}

.template-preview__options-scrim {
  position: absolute;
  z-index: 1;
  inset: 0;
  background: rgba(15, 23, 42, 0.48);
}

.template-preview__options-sheet {
  position: absolute;
  z-index: 2;
  inset-block-end: 0;
  inset-inline: 0;
  max-block-size: 82%;
  overflow: auto;
  padding: 10px 16px 16px;
  border-start-end-radius: 28px;
  border-start-start-radius: 28px;
  background: white;
  box-shadow: 0 -10px 24px rgba(15, 23, 42, 0.18);
}

.template-preview__options-handle {
  inline-size: 34px;
  block-size: 4px;
  margin: 0 auto 14px;
  border-radius: 999px;
  background: #60656c;
}

.template-preview__options-header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 32px;
  align-items: center;
  margin-block-end: 12px;
}

.template-preview__options-header strong {
  text-align: center;
}

.template-preview__options-close {
  display: inline-grid;
  place-items: center;
  inline-size: 32px;
  block-size: 32px;
  border: 0;
  background: transparent;
  color: #111827;
}

.template-preview__options-spacer {
  inline-size: 32px;
  block-size: 32px;
}

.template-preview__options-list {
  display: grid;
  gap: 2px;
}

.template-preview__option-item {
  display: flex;
  align-items: center;
  min-block-size: 38px;
  gap: 10px;
  border: 0;
  background: transparent;
  color: #111827;
  font-weight: 500;
  text-align: start;
}

.template-preview__option-item .v-icon {
  color: #486172;
}

.template-preview__options-divider {
  margin-block: 6px;
}
</style>
