<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  CreateWhatsappTemplateRequest,
  UpdateWhatsappTemplateRequest,
  WhatsappTemplateResponse,
} from '@core/schema/worker/whatsappOfficialTemplate';
import WhatsappTemplateButtonsSection from './WhatsappTemplateButtonsSection.vue';
import WhatsappTemplateCategoryStep from './WhatsappTemplateCategoryStep.vue';
import WhatsappTemplateContentSection from './WhatsappTemplateContentSection.vue';
import WhatsappTemplateNameLanguageSection from './WhatsappTemplateNameLanguageSection.vue';
import WhatsappTemplatePreview from './WhatsappTemplatePreview.vue';
import WhatsappTemplateReviewStep from './WhatsappTemplateReviewStep.vue';
import WhatsappTemplateStepper from './WhatsappTemplateStepper.vue';
import WhatsappTemplateTtlSection from './WhatsappTemplateTtlSection.vue';
import { useWhatsappTemplateEditor } from './useWhatsappTemplateEditor';
import type { TranslateFn } from './types';

const props = defineProps<{
  modelValue: boolean;
  template: WhatsappTemplateResponse | null;
  saving: boolean;
  uploading: boolean;
  uploadMedia: (file: File) => Promise<string | null>;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  save: [
    payload: CreateWhatsappTemplateRequest | UpdateWhatsappTemplateRequest,
  ];
}>();

const { t } = useI18n();
const translate: TranslateFn = (key, params) => t(key, params ?? {});
const templateRef = computed(() => props.template);

const {
  addButton,
  bodyTextError,
  bodyVariables,
  buttonFieldErrors,
  buttonLimitErrors,
  canContinueConfig,
  canSubmit,
  categoryOptions,
  components,
  countryCodeOptions,
  ctaButtonEntries,
  ctaButtonTypes,
  currentStep,
  draft,
  firstValidationError,
  footerTextError,
  handleMediaFile,
  headerFormatOptions,
  headerTextError,
  headerVariables,
  insertBodyMarkup,
  insertBodyVariable,
  insertHeaderVariable,
  insertUrlVariable,
  isEditingRemote,
  isMarketingStandard,
  languageOptions,
  marketingStandardButtonTypes,
  parameterFormatOptions,
  quickReplyButtonEntries,
  quickReplyTypeOptions,
  removeButton,
  selectedLanguageTitle,
  submit,
  subtypeOptions,
  summarySubtitle,
  templateNameError,
  ttlOptions,
  urlTypeOptions,
  validationErrors,
  voiceCallTtlOptions,
} = useWhatsappTemplateEditor({
  template: templateRef,
  uploadMedia: props.uploadMedia,
  save: (payload) => emit('save', payload),
  t: translate,
});

const close = () => {
  emit('update:modelValue', false);
};
</script>

<template>
  <VDialog
    :model-value="modelValue"
    max-width="1480"
    persistent
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <DialogCloseBtn :disabled="saving" @click="close" />

    <VCard class="template-editor">
      <VCardTitle class="template-editor__title">
        {{
          template
            ? t('whatsapp_template_edit_title')
            : t('whatsapp_template_add_title')
        }}
      </VCardTitle>

      <VCardText class="template-editor__content">
        <div class="template-editor__main">
          <WhatsappTemplateStepper v-model="currentStep">
            <VStepperWindow>
              <VStepperWindowItem :value="1">
                <WhatsappTemplateCategoryStep
                  v-model:category="draft.category"
                  v-model:sub-category="draft.sub_category"
                  :category-options="categoryOptions"
                  :subtype-options="subtypeOptions"
                />
              </VStepperWindowItem>

              <VStepperWindowItem :value="2">
                <WhatsappTemplateNameLanguageSection
                  v-model="draft"
                  :is-editing-remote="isEditingRemote"
                  :language-options="languageOptions"
                  :selected-language-title="selectedLanguageTitle"
                  :summary-subtitle="summarySubtitle"
                  :template-name-error="templateNameError"
                />

                <WhatsappTemplateContentSection
                  v-model="draft"
                  :body-text-error="bodyTextError"
                  :body-variables="bodyVariables"
                  :footer-text-error="footerTextError"
                  :header-format-options="headerFormatOptions"
                  :header-text-error="headerTextError"
                  :header-variables="headerVariables"
                  :parameter-format-options="parameterFormatOptions"
                  :uploading="uploading"
                  @handle-media-file="handleMediaFile"
                  @insert-body-markup="insertBodyMarkup"
                  @insert-body-variable="insertBodyVariable"
                  @insert-header-variable="insertHeaderVariable"
                />

                <WhatsappTemplateButtonsSection
                  v-if="isMarketingStandard"
                  v-model="draft"
                  :button-field-errors="buttonFieldErrors"
                  :button-limit-errors="buttonLimitErrors"
                  :country-code-options="countryCodeOptions"
                  :cta-button-entries="ctaButtonEntries"
                  :cta-button-types="ctaButtonTypes"
                  :marketing-standard-button-types="
                    marketingStandardButtonTypes
                  "
                  :quick-reply-button-entries="quickReplyButtonEntries"
                  :quick-reply-type-options="quickReplyTypeOptions"
                  :url-type-options="urlTypeOptions"
                  :voice-call-ttl-options="voiceCallTtlOptions"
                  @add-button="addButton"
                  @insert-url-variable="insertUrlVariable"
                  @remove-button="removeButton"
                />

                <WhatsappTemplateTtlSection
                  v-if="isMarketingStandard"
                  v-model="draft"
                  :ttl-options="ttlOptions"
                />
              </VStepperWindowItem>

              <VStepperWindowItem :value="3">
                <WhatsappTemplateReviewStep
                  v-model="draft"
                  :components-count="components.length"
                  :first-validation-error="firstValidationError"
                  :is-editing-remote="isEditingRemote"
                  :selected-language-title="selectedLanguageTitle"
                  :summary-subtitle="summarySubtitle"
                  :validation-errors="validationErrors"
                />
              </VStepperWindowItem>
            </VStepperWindow>
          </WhatsappTemplateStepper>
        </div>

        <WhatsappTemplatePreview :components="components" />
      </VCardText>

      <VDivider />

      <VCardActions class="template-editor__actions">
        <VBtn color="secondary" variant="tonal" @click="close">
          {{ t('whatsapp_template_discard') }}
        </VBtn>
        <VBtn
          v-if="currentStep > 1"
          color="secondary"
          variant="outlined"
          prepend-icon="tabler-arrow-left"
          @click="currentStep -= 1"
        >
          {{ t('whatsapp_template_back') }}
        </VBtn>
        <VBtn
          v-if="currentStep < 3"
          color="primary"
          variant="flat"
          append-icon="tabler-arrow-right"
          :disabled="currentStep === 1 && !canContinueConfig"
          @click="currentStep += 1"
        >
          {{ t('whatsapp_template_next') }}
        </VBtn>
        <VBtn
          v-else
          color="primary"
          variant="flat"
          append-icon="tabler-send"
          :loading="saving"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ t('whatsapp_template_submit_for_review') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>
</template>

<style>
.template-editor {
  max-block-size: 92vh;
}

.template-editor__title {
  border-block-end: 1px solid
    rgba(var(--v-border-color), var(--v-border-opacity));
}

.template-editor__content {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  padding-block: 20px;
}

.template-editor__main {
  min-inline-size: 0;
}

.template-editor__section,
.template-editor__summary {
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  padding: 18px;
}

.template-editor__section + .template-editor__section,
.template-editor__summary + .template-editor__section {
  margin-block-start: 16px;
}

.template-editor__summary {
  display: flex;
  align-items: center;
  gap: 12px;
}

.template-editor__summary span {
  display: block;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.85rem;
}

.template-editor__summary-icon {
  display: grid;
  place-items: center;
  inline-size: 48px;
  block-size: 48px;
  border-radius: 8px;
  background: #008069;
  color: white;
}

.template-editor__heading {
  margin: 0 0 14px;
  font-size: 1rem;
  font-weight: 700;
}

.template-editor__hint {
  color: rgba(var(--v-theme-on-surface), 0.76);
  font-size: 0.88rem;
  line-height: 1.45;
}

.template-editor__muted,
.template-editor__optional {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.84rem;
  font-weight: 400;
}

.template-editor__category-toggle {
  display: flex;
  inline-size: 100%;
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 6px;
  background: rgb(var(--v-theme-surface));
}

.template-editor__category-toggle .v-btn {
  flex: 1 1 0;
  min-block-size: 42px;
  min-inline-size: 0;
  border-radius: 0;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
}

.template-editor__category-toggle .v-btn--active {
  background: rgba(var(--v-theme-primary), 0.12);
  box-shadow: inset 0 -2px 0 rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
}

.template-editor__category-toggle .v-btn__overlay {
  opacity: 0;
}

.template-editor__subtype-group {
  margin-block-start: 12px;
}

.template-editor__subtype-group .v-selection-control-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-editor__subtype-option {
  display: flex;
  align-items: flex-start;
  inline-size: 100%;
  gap: 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 9px 10px;
  text-align: start;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.template-editor__subtype-option:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.template-editor__subtype-option--active {
  border-color: rgba(var(--v-theme-primary), 0.28);
  background: rgba(var(--v-theme-primary), 0.1);
}

.template-editor__subtype-option .v-selection-control {
  min-block-size: 0;
}

.template-editor__subtype-option .v-selection-control__wrapper {
  margin-block-start: 1px;
}

.template-editor__radio-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.template-editor__radio-label small {
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.template-editor__name-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(210px, 260px);
  gap: 14px;
}

.template-editor__compact-grid,
.template-editor__media-grid {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(180px, 240px);
  gap: 14px;
  margin-block-start: 16px;
}

.template-editor__media-grid {
  grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
}

.template-editor__field-with-info {
  position: relative;
}

.template-editor__info-icon {
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: help;
}

.template-editor__field-stack {
  margin-block-start: 16px;
}

.template-editor__field-actions,
.template-editor__body-tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  margin-block-start: 4px;
}

.template-editor__sample-panel,
.template-editor__deep-link-panel {
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.035);
  padding: 14px;
}

.template-editor__sample-panel {
  margin-block-start: 16px;
}

.template-editor__sample-panel p {
  margin: 6px 0 12px;
  font-size: 0.86rem;
}

.template-editor__samples + .template-editor__samples {
  margin-block-start: 14px;
}

.template-editor__sample-row {
  display: grid;
  grid-template-columns: 170px minmax(0, 1fr);
  gap: 8px;
  margin-block-start: 8px;
}

.template-editor__notice {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.78);
  margin-block-start: 14px;
  padding: 12px;
  font-size: 0.88rem;
}

.template-editor__section-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.template-editor__button-group {
  margin-block-start: 18px;
}

.template-editor__button-group h4 {
  margin: 0 0 8px;
  font-size: 0.9rem;
}

.template-editor__button-row,
.template-editor__cta-row {
  position: relative;
  border-radius: 6px;
  background: rgba(var(--v-theme-on-surface), 0.035);
  padding: 10px;
}

.template-editor__button-row {
  display: grid;
  align-items: start;
  grid-template-columns: 240px minmax(0, 1fr) 40px;
  gap: 10px;
}

.template-editor__button-row + .template-editor__button-row,
.template-editor__cta-row + .template-editor__cta-row {
  margin-block-start: 10px;
}

.template-editor__cta-grid {
  display: grid;
  align-items: start;
  grid-template-columns: 160px minmax(180px, 1fr) 120px minmax(200px, 1.2fr);
  gap: 10px;
  padding-inline-end: 42px;
}

.template-editor__wide-field,
.template-editor__deep-link-panel {
  grid-column: 1 / -1;
}

.template-editor__button-remove {
  position: absolute;
  inset-block-start: 28px;
  inset-inline-end: 8px;
}

.template-editor__ttl-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.template-editor__review {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.template-editor__review > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  padding: 14px;
}

.template-editor__review span {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.85rem;
}

.template-editor__actions {
  justify-content: flex-end;
  gap: 12px;
  padding: 16px;
}

.template-editor__tooltip {
  border-radius: 6px !important;
  background: rgb(var(--v-theme-surface)) !important;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.18) !important;
  color: rgb(var(--v-theme-on-surface)) !important;
  line-height: 1.45;
  padding: 12px 14px !important;
}

@media (max-width: 1180px) {
  .template-editor__content {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 820px) {
  .template-editor__name-grid,
  .template-editor__compact-grid,
  .template-editor__media-grid,
  .template-editor__review,
  .template-editor__sample-row,
  .template-editor__button-row,
  .template-editor__cta-grid {
    grid-template-columns: 1fr;
  }

  .template-editor__category-toggle .v-btn {
    padding-inline: 8px;
    font-size: 0.82rem;
  }

  .template-editor__section-title-row,
  .template-editor__ttl-header {
    flex-direction: column;
  }
}
</style>
