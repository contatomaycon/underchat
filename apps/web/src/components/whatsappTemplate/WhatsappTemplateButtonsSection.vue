<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { getButtonIcon } from './constants';
import type {
  ButtonDraft,
  ButtonEntry,
  ButtonType,
  QuickReplyType,
  SelectOption,
  TemplateDraft,
  UrlType,
} from './types';
import type { ButtonField } from './validation';

const props = withDefaults(
  defineProps<{
    buttonFieldErrors: (button: ButtonDraft, field: ButtonField) => string[];
    buttonLimitErrors: string[];
    canAddButtonType: (type: ButtonType) => boolean;
    canUseButtonType: (type: ButtonType, exceptIndex?: number) => boolean;
    countryCodeOptions: SelectOption[];
    ctaButtonEntries: ButtonEntry[];
    ctaButtonTypes: SelectOption<ButtonType>[];
    loadingMetaApps?: boolean;
    marketingStandardButtonTypes: SelectOption<ButtonType>[];
    metaAppOptions?: SelectOption[];
    quickReplyButtonEntries: ButtonEntry[];
    quickReplyTypeOptions: SelectOption[];
    urlTypeOptions: SelectOption<UrlType>[];
    voiceCallTtlOptions: SelectOption<number>[];
  }>(),
  {
    loadingMetaApps: false,
    metaAppOptions: () => [],
  }
);

const emit = defineEmits<{
  addButton: [type: ButtonType];
  openMetaAppSelect: [];
  removeButton: [index: number];
  reorderButton: [fromIndex: number, toIndex: number];
  updateButtonType: [index: number, type: ButtonType];
  updateQuickReplyType: [index: number, type: QuickReplyType];
  updateUrlType: [index: number, type: UrlType];
}>();

const draft = defineModel<TemplateDraft>({ required: true });
const { t } = useI18n();
type ButtonDragGroup = 'quick' | 'cta';
type ButtonTypeSelectItem = SelectOption<ButtonType> & {
  disabled: boolean;
  limitText: string;
  props: {
    disabled: boolean;
  };
};

const draggingButtonIndex = shallowRef<number | null>(null);
const dragOverButtonIndex = shallowRef<number | null>(null);
const draggingButtonGroup = shallowRef<ButtonDragGroup | null>(null);
const urlDynamicVariableToken = '{{1}}';

const canAddAnyButton = computed(() =>
  props.marketingStandardButtonTypes.some((option) =>
    props.canAddButtonType(option.value)
  )
);

const buttonTypeLimitText = (type: ButtonType) => {
  if (type === 'URL') return t('whatsapp_template_button_limit_url');
  if (
    type === 'PHONE_NUMBER' ||
    type === 'VOICE_CALL' ||
    type === 'COPY_CODE'
  ) {
    return t('whatsapp_template_button_limit_single');
  }

  return '';
};

const ctaButtonTypeItems = (index: number) =>
  props.ctaButtonTypes.map<ButtonTypeSelectItem>((option) => {
    const disabled = !props.canUseButtonType(option.value, index);

    return {
      ...option,
      disabled,
      limitText: disabled ? buttonTypeLimitText(option.value) : '',
      props: {
        disabled,
      },
    };
  });

const getCtaSelectItem = (item: unknown) => {
  const candidate = item as {
    raw?: ButtonTypeSelectItem;
    props?: { disabled?: boolean };
    title?: string;
    value?: ButtonType;
  };

  if (candidate.raw) return candidate.raw;

  return {
    title: candidate.title ?? '',
    value: candidate.value as ButtonType,
    disabled: Boolean(candidate.props?.disabled),
    limitText: '',
    props: {
      disabled: Boolean(candidate.props?.disabled),
    },
  };
};

const isCtaSelectItemDisabled = (item: unknown) =>
  getCtaSelectItem(item).disabled;

const handleAddButton = (type: ButtonType) => {
  if (!props.canAddButtonType(type)) return;

  emit('addButton', type);
};

const updateButtonType = (index: number, value: unknown) => {
  const nextType = value as ButtonType;

  if (!props.canUseButtonType(nextType, index)) return;

  emit('updateButtonType', index, nextType);
};

const updateQuickReplyType = (index: number, value: unknown) => {
  emit('updateQuickReplyType', index, value as QuickReplyType);
};

const updateUrlType = (index: number, value: unknown) => {
  emit('updateUrlType', index, value as UrlType);
};

const isDynamicUrlButton = (button: ButtonDraft) =>
  button.type === 'URL' && button.url_type === 'DYNAMIC';

const shouldShowUrlSample = (button: ButtonDraft) =>
  isDynamicUrlButton(button) && Boolean(button.url.trim());

const urlSampleTarget = (button: ButtonDraft) => {
  const baseUrl = button.url.trim();
  if (!baseUrl) return urlDynamicVariableToken;

  return `${baseUrl}${baseUrl.endsWith('/') ? '' : '/'}${urlDynamicVariableToken}`;
};

const handleMetaAppMenu = (isOpen: boolean) => {
  if (isOpen) {
    emit('openMetaAppSelect');
  }
};

const isBrazilCountryCode = (countryCode: string) => countryCode === '+55';

const normalizeBrazilPhoneDigits = (value: unknown) => {
  const digits = String(value ?? '').replace(/\D/gu, '');
  const nationalDigits =
    digits.length > 11 && digits.startsWith('55') ? digits.slice(2) : digits;

  return nationalDigits.slice(0, 11);
};

const formatBrazilPhoneNumber = (value: string) => {
  const digits = normalizeBrazilPhoneDigits(value);

  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
};

const isBrazilPhoneButton = (button: ButtonDraft) =>
  button.type === 'PHONE_NUMBER' &&
  isBrazilCountryCode(button.phone_country_code);

const phoneNumberInputValue = (button: ButtonDraft) =>
  isBrazilPhoneButton(button)
    ? formatBrazilPhoneNumber(button.phone_number)
    : button.phone_number;

const phoneNumberMaxLength = (button: ButtonDraft) =>
  isBrazilPhoneButton(button) ? 15 : 20;

const updatePhoneCountryCode = (button: ButtonDraft, value: unknown) => {
  button.phone_country_code = String(value ?? '');

  if (isBrazilPhoneButton(button)) {
    button.phone_number = normalizeBrazilPhoneDigits(button.phone_number);
  }
};

const updatePhoneNumber = (button: ButtonDraft, value: unknown) => {
  button.phone_number = isBrazilPhoneButton(button)
    ? normalizeBrazilPhoneDigits(value)
    : String(value ?? '');
};

const resetButtonDrag = () => {
  draggingButtonIndex.value = null;
  dragOverButtonIndex.value = null;
  draggingButtonGroup.value = null;
};

const beginButtonDrag = (
  event: DragEvent,
  entry: ButtonEntry,
  group: ButtonDragGroup
) => {
  draggingButtonIndex.value = entry.index;
  dragOverButtonIndex.value = entry.index;
  draggingButtonGroup.value = group;

  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', entry.index.toString());
  }
};

const handleButtonDragOver = (
  event: DragEvent,
  entry: ButtonEntry,
  group: ButtonDragGroup
) => {
  if (
    draggingButtonIndex.value === null ||
    draggingButtonGroup.value !== group
  ) {
    return;
  }

  event.preventDefault();

  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move';
  }

  if (draggingButtonIndex.value !== entry.index) {
    dragOverButtonIndex.value = entry.index;
  }
};

const handleButtonDrop = (
  event: DragEvent,
  entry: ButtonEntry,
  group: ButtonDragGroup
) => {
  event.preventDefault();

  const fromIndex = draggingButtonIndex.value;
  const fromGroup = draggingButtonGroup.value;
  resetButtonDrag();

  if (fromIndex === null || fromIndex === entry.index || fromGroup !== group) {
    return;
  }

  emit('reorderButton', fromIndex, entry.index);
};

const isDraggingButton = (index: number) => draggingButtonIndex.value === index;

const isButtonDropTarget = (index: number) =>
  draggingButtonIndex.value !== null &&
  dragOverButtonIndex.value === index &&
  draggingButtonIndex.value !== index;
</script>

<template>
  <section class="template-editor__section">
    <div class="template-editor__section-title-row">
      <div>
        <h3 class="template-editor__heading mb-1">
          {{ t('whatsapp_template_buttons_heading') }}
          <span class="template-editor__optional">
            {{ t('whatsapp_template_optional') }}
          </span>
        </h3>
        <p class="template-editor__hint mb-0">
          {{ t('whatsapp_template_buttons_hint') }}
        </p>
      </div>
    </div>

    <div class="template-editor__button-menu-row">
      <VMenu :disabled="!canAddAnyButton">
        <template #activator="{ props: menuProps }">
          <VTooltip
            :disabled="canAddAnyButton"
            location="top"
            max-width="360"
            content-class="template-editor__tooltip"
          >
            <template #activator="{ props: tooltipProps }">
              <span
                v-bind="tooltipProps"
                class="template-editor__button-limit-activator"
              >
                <VBtn
                  v-bind="canAddAnyButton ? menuProps : {}"
                  variant="outlined"
                  prepend-icon="tabler-plus"
                  append-icon="tabler-chevron-down"
                  :disabled="!canAddAnyButton"
                >
                  {{ t('whatsapp_template_add_button') }}
                </VBtn>
              </span>
            </template>
            <div class="template-editor__tooltip-title">
              {{ t('whatsapp_template_button_limit_reached_title') }}
            </div>
            <div>
              {{ t('whatsapp_template_button_limit_reached_message') }}
            </div>
          </VTooltip>
        </template>
        <VList density="compact">
          <VListItem
            v-for="option in marketingStandardButtonTypes"
            :key="option.value"
            :disabled="!canAddButtonType(option.value)"
            @click="handleAddButton(option.value)"
          >
            <template #prepend>
              <VIcon :icon="getButtonIcon(option.value)" size="18" />
            </template>
            <VListItemTitle>{{ option.title }}</VListItemTitle>
            <VListItemSubtitle v-if="buttonTypeLimitText(option.value)">
              {{ buttonTypeLimitText(option.value) }}
            </VListItemSubtitle>
          </VListItem>
        </VList>
      </VMenu>
    </div>

    <VAlert
      v-if="buttonLimitErrors.length"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-4"
    >
      {{ buttonLimitErrors[0] }}
    </VAlert>

    <div
      v-if="quickReplyButtonEntries.length"
      class="template-editor__button-group"
    >
      <h4>
        {{ t('whatsapp_template_quick_reply_heading') }}
        <span class="template-editor__optional">
          {{ t('whatsapp_template_optional') }}
        </span>
      </h4>
      <div
        v-for="entry in quickReplyButtonEntries"
        :key="`quick-${entry.index}`"
        class="template-editor__button-row"
        :class="{
          'template-editor__sortable-row--dragging': isDraggingButton(
            entry.index
          ),
          'template-editor__sortable-row--drop-target': isButtonDropTarget(
            entry.index
          ),
        }"
        @dragover.stop="handleButtonDragOver($event, entry, 'quick')"
        @drop.stop="handleButtonDrop($event, entry, 'quick')"
      >
        <VIcon
          icon="tabler-grip-vertical"
          class="template-editor__drag-handle"
          :class="{
            'template-editor__drag-handle--active': isDraggingButton(
              entry.index
            ),
          }"
          draggable="true"
          role="button"
          :title="t('whatsapp_template_drag_button')"
          :aria-label="t('whatsapp_template_drag_button')"
          @dragstart.stop="beginButtonDrag($event, entry, 'quick')"
          @dragend.stop="resetButtonDrag"
        />
        <div class="template-editor__button-scroll">
          <AppSelect
            :model-value="entry.button.quick_reply_type"
            :label="t('whatsapp_template_button_type_label')"
            :items="quickReplyTypeOptions"
            item-title="title"
            item-value="value"
            @update:model-value="updateQuickReplyType(entry.index, $event)"
          />
          <AppTextField
            v-model="entry.button.text"
            :label="t('whatsapp_template_button_text_label')"
            maxlength="40"
            :counter="40"
            :error-messages="buttonFieldErrors(entry.button, 'text')"
          />
        </div>
        <IconBtn @click="emit('removeButton', entry.index)">
          <VIcon icon="tabler-x" />
        </IconBtn>
      </div>
    </div>

    <div v-if="ctaButtonEntries.length" class="template-editor__button-group">
      <h4>
        {{ t('whatsapp_template_cta_heading') }}
        <span class="template-editor__optional">
          {{ t('whatsapp_template_optional') }}
        </span>
      </h4>
      <div
        v-for="entry in ctaButtonEntries"
        :key="`cta-${entry.index}`"
        class="template-editor__cta-row"
        :class="{
          'template-editor__sortable-row--dragging': isDraggingButton(
            entry.index
          ),
          'template-editor__sortable-row--drop-target': isButtonDropTarget(
            entry.index
          ),
        }"
        @dragover.stop="handleButtonDragOver($event, entry, 'cta')"
        @drop.stop="handleButtonDrop($event, entry, 'cta')"
      >
        <VIcon
          icon="tabler-grip-vertical"
          class="template-editor__drag-handle"
          :class="{
            'template-editor__drag-handle--active': isDraggingButton(
              entry.index
            ),
          }"
          draggable="true"
          role="button"
          :title="t('whatsapp_template_drag_button')"
          :aria-label="t('whatsapp_template_drag_button')"
          @dragstart.stop="beginButtonDrag($event, entry, 'cta')"
          @dragend.stop="resetButtonDrag"
        />
        <div class="template-editor__cta-scroll">
          <div
            class="template-editor__cta-grid"
            :class="{
              'template-editor__cta-grid--voice-call':
                entry.button.type === 'VOICE_CALL',
              'template-editor__cta-grid--copy-code':
                entry.button.type === 'COPY_CODE',
            }"
          >
            <AppSelect
              :model-value="entry.button.type"
              :label="t('whatsapp_template_action_type_label')"
              :items="ctaButtonTypeItems(entry.index)"
              item-title="title"
              item-value="value"
              item-props
              @update:model-value="updateButtonType(entry.index, $event)"
            >
              <template #item="{ item, props: itemProps }">
                <VListItem
                  v-bind="itemProps"
                  :title="undefined"
                  :subtitle="undefined"
                  :disabled="isCtaSelectItemDisabled(item)"
                  :class="{
                    'template-editor__select-option--disabled':
                      isCtaSelectItemDisabled(item),
                  }"
                >
                  <VListItemTitle>
                    {{ getCtaSelectItem(item).title }}
                  </VListItemTitle>
                  <VListItemSubtitle v-if="getCtaSelectItem(item).limitText">
                    {{ getCtaSelectItem(item).limitText }}
                  </VListItemSubtitle>
                </VListItem>
              </template>
            </AppSelect>

            <AppTextField
              v-if="entry.button.type !== 'COPY_CODE'"
              v-model="entry.button.text"
              :label="t('whatsapp_template_button_text_label')"
              maxlength="40"
              :counter="40"
              :error-messages="buttonFieldErrors(entry.button, 'text')"
            />

            <template v-if="entry.button.type === 'URL'">
              <AppSelect
                :model-value="entry.button.url_type"
                :label="t('whatsapp_template_url_type_label')"
                :items="urlTypeOptions"
                item-title="title"
                item-value="value"
                @update:model-value="updateUrlType(entry.index, $event)"
              />
              <div
                class="template-editor__field-with-url-variable template-editor__field-with-url-variable--labeled"
              >
                <AppTextField
                  v-model="entry.button.url"
                  class="template-editor__url-input"
                  :label="t('whatsapp_template_website_url_label')"
                  :placeholder="t('whatsapp_template_website_url_placeholder')"
                  maxlength="2000"
                  :counter="2000"
                  :error-messages="buttonFieldErrors(entry.button, 'url')"
                />
                <span
                  v-if="isDynamicUrlButton(entry.button)"
                  class="template-editor__url-variable-suffix"
                >
                  {{ urlDynamicVariableToken }}
                  <VTooltip
                    location="top"
                    max-width="360"
                    content-class="template-editor__tooltip"
                  >
                    <template #activator="{ props: tooltipProps }">
                      <VIcon
                        v-bind="tooltipProps"
                        icon="tabler-info-circle"
                        size="16"
                        class="template-editor__info-icon"
                      />
                    </template>
                    {{ t('whatsapp_template_url_dynamic_variable_tooltip') }}
                  </VTooltip>
                </span>
              </div>
              <div
                v-if="shouldShowUrlSample(entry.button)"
                class="template-editor__url-sample-panel template-editor__wide-field"
              >
                <div class="template-editor__url-sample-heading">
                  {{ t('whatsapp_template_url_sample_title') }}
                </div>
                <div class="template-editor__url-sample-description">
                  {{ t('whatsapp_template_url_sample_description') }}
                </div>
                <div class="template-editor__url-sample-input-row">
                  <span class="template-editor__url-sample-token">
                    {{ urlDynamicVariableToken }}
                  </span>
                  <AppTextField
                    v-model="entry.button.url_example"
                    class="template-editor__url-sample-input"
                    :placeholder="
                      t('whatsapp_template_url_sample_full_placeholder', {
                        url: urlSampleTarget(entry.button),
                      })
                    "
                    :error-messages="
                      buttonFieldErrors(entry.button, 'url_example')
                    "
                  />
                </div>
              </div>
              <VCheckbox
                v-model="entry.button.track_app_conversions"
                hide-details
                class="template-editor__wide-field template-editor__conversion-checkbox"
              >
                <template #label>
                  <span class="template-editor__checkbox-label">
                    {{ t('whatsapp_template_track_app_conversions') }}
                    <VTooltip
                      location="top"
                      max-width="320"
                      content-class="template-editor__tooltip"
                    >
                      <template #activator="{ props: tooltipProps }">
                        <VIcon
                          v-bind="tooltipProps"
                          icon="tabler-info-circle"
                          size="16"
                          class="template-editor__info-icon"
                        />
                      </template>
                      {{ t('whatsapp_template_track_app_conversions_tooltip') }}
                    </VTooltip>
                  </span>
                </template>
              </VCheckbox>
              <div
                v-if="entry.button.track_app_conversions"
                class="template-editor__deep-link-panel"
              >
                <AppAutocomplete
                  v-model="entry.button.meta_app_id"
                  :label="t('whatsapp_template_meta_app_id_label')"
                  :placeholder="t('whatsapp_template_meta_app_id_placeholder')"
                  :items="metaAppOptions"
                  item-title="title"
                  item-value="value"
                  :loading="loadingMetaApps"
                  :no-data-text="t('whatsapp_template_meta_apps_empty')"
                  clearable
                  clear-icon="tabler-x"
                  :error-messages="
                    buttonFieldErrors(entry.button, 'meta_app_id')
                  "
                  @update:menu="handleMetaAppMenu"
                />
                <div class="template-editor__labeled-field">
                  <VLabel class="template-editor__inline-label">
                    {{ t('whatsapp_template_android_deep_link_label') }}
                    <VTooltip
                      location="top"
                      max-width="320"
                      content-class="template-editor__tooltip"
                    >
                      <template #activator="{ props: tooltipProps }">
                        <VIcon
                          v-bind="tooltipProps"
                          icon="tabler-info-circle"
                          size="16"
                          class="template-editor__info-icon"
                        />
                      </template>
                      {{ t('whatsapp_template_android_deep_link_tooltip') }}
                    </VTooltip>
                  </VLabel>
                  <div class="template-editor__field-with-url-variable">
                    <AppTextField
                      v-model="entry.button.android_deep_link"
                      class="template-editor__url-input"
                      :placeholder="
                        t('whatsapp_template_android_deep_link_placeholder')
                      "
                      :error-messages="
                        buttonFieldErrors(entry.button, 'android_deep_link')
                      "
                    />
                    <span
                      v-if="isDynamicUrlButton(entry.button)"
                      class="template-editor__url-variable-suffix"
                    >
                      {{ urlDynamicVariableToken }}
                      <VTooltip
                        location="top"
                        max-width="360"
                        content-class="template-editor__tooltip"
                      >
                        <template #activator="{ props: tooltipProps }">
                          <VIcon
                            v-bind="tooltipProps"
                            icon="tabler-info-circle"
                            size="16"
                            class="template-editor__info-icon"
                          />
                        </template>
                        {{
                          t('whatsapp_template_url_dynamic_variable_tooltip')
                        }}
                      </VTooltip>
                    </span>
                  </div>
                </div>
                <div class="template-editor__labeled-field">
                  <VLabel class="template-editor__inline-label">
                    {{ t('whatsapp_template_android_fallback_label') }}
                    <VTooltip
                      location="top"
                      max-width="320"
                      content-class="template-editor__tooltip"
                    >
                      <template #activator="{ props: tooltipProps }">
                        <VIcon
                          v-bind="tooltipProps"
                          icon="tabler-info-circle"
                          size="16"
                          class="template-editor__info-icon"
                        />
                      </template>
                      {{ t('whatsapp_template_android_fallback_tooltip') }}
                    </VTooltip>
                  </VLabel>
                  <div class="template-editor__field-with-url-variable">
                    <AppTextField
                      v-model="entry.button.android_fallback_playstore_url"
                      class="template-editor__url-input"
                      :placeholder="
                        t('whatsapp_template_android_fallback_placeholder')
                      "
                      :error-messages="
                        buttonFieldErrors(
                          entry.button,
                          'android_fallback_playstore_url'
                        )
                      "
                    />
                    <span
                      v-if="isDynamicUrlButton(entry.button)"
                      class="template-editor__url-variable-suffix"
                    >
                      {{ urlDynamicVariableToken }}
                      <VTooltip
                        location="top"
                        max-width="360"
                        content-class="template-editor__tooltip"
                      >
                        <template #activator="{ props: tooltipProps }">
                          <VIcon
                            v-bind="tooltipProps"
                            icon="tabler-info-circle"
                            size="16"
                            class="template-editor__info-icon"
                          />
                        </template>
                        {{
                          t('whatsapp_template_url_dynamic_variable_tooltip')
                        }}
                      </VTooltip>
                    </span>
                  </div>
                </div>
              </div>
            </template>

            <template v-if="entry.button.type === 'PHONE_NUMBER'">
              <AppAutocomplete
                :model-value="entry.button.phone_country_code"
                :label="t('whatsapp_template_country_label')"
                :items="countryCodeOptions"
                item-title="title"
                item-value="value"
                density="compact"
                @update:model-value="
                  updatePhoneCountryCode(entry.button, $event)
                "
              />
              <AppTextField
                :model-value="phoneNumberInputValue(entry.button)"
                :label="t('whatsapp_template_phone_label')"
                :placeholder="t('whatsapp_template_phone_placeholder')"
                :maxlength="phoneNumberMaxLength(entry.button)"
                :counter="phoneNumberMaxLength(entry.button)"
                :error-messages="
                  buttonFieldErrors(entry.button, 'phone_number')
                "
                @update:model-value="updatePhoneNumber(entry.button, $event)"
              />
            </template>

            <template v-if="entry.button.type === 'VOICE_CALL'">
              <div class="template-editor__field-with-info">
                <AppSelect
                  v-model="entry.button.voice_call_ttl_minutes"
                  :label="t('whatsapp_template_active_for_label')"
                  :items="voiceCallTtlOptions"
                  item-title="title"
                  item-value="value"
                />
                <VTooltip
                  location="top"
                  max-width="320"
                  content-class="template-editor__tooltip"
                >
                  <template #activator="{ props: tooltipProps }">
                    <VIcon
                      v-bind="tooltipProps"
                      icon="tabler-info-circle"
                      size="16"
                      class="template-editor__info-icon ms-1"
                    />
                  </template>
                  {{ t('whatsapp_template_active_for_tooltip') }}
                </VTooltip>
              </div>
              <div class="template-editor__notice template-editor__wide-field">
                <VIcon icon="tabler-info-circle" size="18" />
                {{ t('whatsapp_template_voice_call_notice') }}
              </div>
            </template>

            <template v-if="entry.button.type === 'COPY_CODE'">
              <AppTextField
                :model-value="t('whatsapp_template_button_default_copy_code')"
                :label="t('whatsapp_template_button_text_label')"
                disabled
              />
              <AppTextField
                v-model="entry.button.offer_code"
                :label="t('whatsapp_template_offer_code_label')"
                :placeholder="t('whatsapp_template_offer_code_placeholder')"
                maxlength="20"
                :counter="20"
                :error-messages="buttonFieldErrors(entry.button, 'offer_code')"
              />
            </template>
          </div>
        </div>
        <IconBtn
          class="template-editor__button-remove"
          @click="emit('removeButton', entry.index)"
        >
          <VIcon icon="tabler-x" />
        </IconBtn>
      </div>
    </div>
  </section>
</template>
