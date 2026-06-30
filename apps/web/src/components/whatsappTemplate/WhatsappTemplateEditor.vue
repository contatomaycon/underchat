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
import type { SelectOption, TranslateFn } from './types';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    template: WhatsappTemplateResponse | null;
    saving: boolean;
    uploading: boolean;
    loadingMetaApps?: boolean;
    metaAppOptions?: SelectOption[];
    uploadMedia: (file: File) => Promise<string | null>;
  }>(),
  {
    loadingMetaApps: false,
    metaAppOptions: () => [],
  }
);

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  loadMetaApps: [];
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
  canAddButtonType,
  canContinueConfig,
  canSubmit,
  canUseButtonType,
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
  headerMediaError,
  headerTextError,
  headerVariables,
  insertBodyMarkup,
  insertBodyVariable,
  insertHeaderVariable,
  isEditingRemote,
  isMarketingStandard,
  languageOptions,
  marketingStandardButtonTypes,
  mediaAttachment,
  parameterFormatOptions,
  quickReplyButtonEntries,
  quickReplyTypeOptions,
  removeMediaFile,
  removeButton,
  reorderButton,
  selectedLanguageTitle,
  submit,
  subtypeOptions,
  summarySubtitle,
  templateNameError,
  ttlOptions,
  urlTypeOptions,
  validationErrors,
  voiceCallTtlOptions,
  updateButtonType,
  updateQuickReplyType,
  updateUrlType,
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
                  :header-media-error="headerMediaError"
                  :header-text-error="headerTextError"
                  :header-variables="headerVariables"
                  :media-attachment="mediaAttachment"
                  :parameter-format-options="parameterFormatOptions"
                  :uploading="uploading"
                  @handle-media-file="handleMediaFile"
                  @insert-body-markup="insertBodyMarkup"
                  @insert-body-variable="insertBodyVariable"
                  @insert-header-variable="insertHeaderVariable"
                  @remove-media-file="removeMediaFile"
                />

                <WhatsappTemplateButtonsSection
                  v-if="isMarketingStandard"
                  v-model="draft"
                  :button-field-errors="buttonFieldErrors"
                  :button-limit-errors="buttonLimitErrors"
                  :can-add-button-type="canAddButtonType"
                  :can-use-button-type="canUseButtonType"
                  :country-code-options="countryCodeOptions"
                  :cta-button-entries="ctaButtonEntries"
                  :cta-button-types="ctaButtonTypes"
                  :marketing-standard-button-types="
                    marketingStandardButtonTypes
                  "
                  :quick-reply-button-entries="quickReplyButtonEntries"
                  :quick-reply-type-options="quickReplyTypeOptions"
                  :url-type-options="urlTypeOptions"
                  :loading-meta-apps="loadingMetaApps"
                  :meta-app-options="metaAppOptions"
                  :voice-call-ttl-options="voiceCallTtlOptions"
                  @add-button="addButton"
                  @open-meta-app-select="emit('loadMetaApps')"
                  @remove-button="removeButton"
                  @reorder-button="reorderButton"
                  @update-button-type="updateButtonType"
                  @update-quick-reply-type="updateQuickReplyType"
                  @update-url-type="updateUrlType"
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

        <WhatsappTemplatePreview
          :components="components"
          :header-format="draft.header_format"
          :media-attachment="mediaAttachment"
        />
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
  background: rgba(var(--v-theme-on-surface), 0.12);
  box-shadow: none;
  color: rgb(var(--v-theme-on-surface));
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
  grid-template-columns: minmax(180px, 240px);
  gap: 14px;
  margin-block-start: 16px;
}

.template-editor__media-grid {
  grid-template-columns: minmax(0, 1fr) minmax(220px, 280px);
}

.template-editor__field-with-info {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  position: relative;
}

.template-editor__field-with-info > .app-select,
.template-editor__field-with-info > .app-autocomplete,
.template-editor__field-with-info > .app-text-field {
  flex: 1 1 auto;
  min-inline-size: 0;
}

.template-editor__select-block {
  max-inline-size: 240px;
}

.template-editor__inline-label {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-block-end: 6px;
  color: rgba(var(--v-theme-on-surface), 0.86);
  font-size: 0.84rem;
  font-weight: 600;
  line-height: 1.2;
}

.template-editor__info-icon {
  color: rgba(var(--v-theme-on-surface), 0.72);
  cursor: help;
}

.template-editor__media-upload-wrapper {
  margin-block-start: 16px;
}

.template-editor__media-upload {
  display: flex;
  align-items: center;
  justify-content: center;
  min-block-size: 78px;
  inline-size: 100%;
  border: 2px dashed rgba(var(--v-border-color), 0.46);
  border-radius: 2px;
  background: rgba(var(--v-theme-surface), 0.72);
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: 14px;
  text-align: center;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.template-editor__media-upload:hover {
  border-color: rgba(var(--v-theme-primary), 0.42);
  background: rgba(var(--v-theme-primary), 0.025);
}

.template-editor__media-upload--dragging {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}

.template-editor__media-upload:disabled {
  cursor: progress;
  opacity: 0.72;
}

.template-editor__media-input {
  display: none;
}

.template-editor__media-upload-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.86rem;
  line-height: 1.45;
  text-align: center;
}

.template-editor__media-upload-copy strong {
  color: rgba(var(--v-theme-on-surface), 0.82);
  font-size: 0.9rem;
  font-weight: 600;
}

.template-editor__media-upload-link {
  color: rgb(var(--v-theme-primary));
  font: inherit;
}

.template-editor__media-upload:hover .template-editor__media-upload-link {
  text-decoration: underline;
}

.template-editor__media-ready {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  color: rgb(var(--v-theme-success));
  font-weight: 600;
}

.template-editor__media-attachment {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) 36px;
  align-items: center;
  min-block-size: 52px;
  gap: 10px;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.14);
  padding: 8px;
}

.template-editor__media-attachment-preview {
  display: grid;
  place-items: center;
  inline-size: 32px;
  block-size: 32px;
  overflow: hidden;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.16);
  color: rgba(var(--v-theme-on-surface), 0.68);
}

.template-editor__media-attachment-preview img {
  inline-size: 100%;
  block-size: 100%;
  object-fit: cover;
}

.template-editor__media-attachment-name {
  overflow: hidden;
  color: rgba(var(--v-theme-on-surface), 0.88);
  font-size: 0.88rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.template-editor__media-error {
  margin-block-start: 8px;
}

.template-editor__field-error {
  color: rgb(var(--v-theme-error));
  font-size: 0.78rem;
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

.template-editor__button-menu-row {
  display: flex;
  margin-block-start: 10px;
}

.template-editor__button-limit-activator {
  display: inline-flex;
}

.template-editor__select-option--disabled {
  opacity: 0.48;
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
  padding: 12px;
}

.template-editor__button-row,
.template-editor__cta-row {
  display: grid;
  align-items: start;
  grid-template-columns: 18px minmax(0, 1fr) 40px;
  gap: 10px;
}

.template-editor__drag-handle {
  align-self: center;
  color: rgba(var(--v-theme-on-surface), 0.56);
  cursor: grab;
}

.template-editor__drag-handle--active,
.template-editor__drag-handle:active {
  cursor: grabbing;
}

.template-editor__sortable-row--dragging {
  opacity: 0.52;
}

.template-editor__sortable-row--drop-target {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
  background: rgba(var(--v-theme-primary), 0.08);
}

.template-editor__button-scroll,
.template-editor__cta-scroll {
  min-inline-size: 0;
  overflow-x: auto;
  padding-block-end: 3px;
}

.template-editor__button-scroll {
  display: grid;
  grid-template-columns: 250px minmax(360px, 1fr);
  gap: 10px;
  min-inline-size: 640px;
}

.template-editor__button-row + .template-editor__button-row,
.template-editor__cta-row + .template-editor__cta-row {
  margin-block-start: 10px;
}

.template-editor__cta-grid {
  display: grid;
  align-items: start;
  grid-template-columns: 150px minmax(190px, 250px) 120px minmax(260px, 1fr);
  gap: 10px;
  min-inline-size: 810px;
}

.template-editor__cta-grid--voice-call {
  grid-template-columns: minmax(150px, 180px) minmax(320px, 1fr) minmax(
      140px,
      180px
    );
}

.template-editor__cta-grid--copy-code {
  grid-template-columns: minmax(150px, 190px) minmax(280px, 1fr) minmax(
      280px,
      1fr
    );
}

.template-editor__wide-field,
.template-editor__deep-link-panel {
  grid-column: 1 / -1;
}

.template-editor__button-remove {
  align-self: start;
  margin-block-start: 24px;
}

.template-editor__conversion-checkbox {
  margin-block-start: -2px;
}

.template-editor__checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.template-editor__field-with-url-variable {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  min-inline-size: 0;
}

.template-editor__url-input {
  flex: 1 1 auto;
  min-inline-size: 0;
}

.template-editor__url-variable-suffix {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.82rem;
  font-weight: 600;
  margin-block-start: 10px;
  white-space: nowrap;
}

.template-editor__field-with-url-variable--labeled
  .template-editor__url-variable-suffix {
  margin-block-start: 31px;
}

.template-editor__url-sample-panel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-block-start: 4px;
}

.template-editor__url-sample-heading {
  color: rgba(var(--v-theme-on-surface), 0.86);
  font-size: 0.875rem;
  font-weight: 700;
}

.template-editor__url-sample-description {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.875rem;
  line-height: 1.35;
}

.template-editor__url-sample-input-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-block-start: 8px;
}

.template-editor__url-sample-token {
  color: rgba(var(--v-theme-on-surface), 0.86);
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 38px;
  white-space: nowrap;
}

.template-editor__url-sample-input {
  flex: 1 1 auto;
  min-inline-size: 0;
}

.template-editor__conversion-checkbox .v-selection-control {
  min-height: 32px;
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

.template-editor__tooltip-title {
  font-weight: 600;
  margin-block-end: 6px;
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

  .template-editor__button-scroll,
  .template-editor__cta-grid {
    min-inline-size: 720px;
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
