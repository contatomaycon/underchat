<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { getButtonIcon } from './constants';
import type {
  ButtonDraft,
  ButtonEntry,
  ButtonType,
  SelectOption,
  TemplateDraft,
} from './types';
import type { ButtonField } from './validation';

defineProps<{
  buttonFieldErrors: (button: ButtonDraft, field: ButtonField) => string[];
  buttonLimitErrors: string[];
  countryCodeOptions: SelectOption[];
  ctaButtonEntries: ButtonEntry[];
  ctaButtonTypes: SelectOption<ButtonType>[];
  marketingStandardButtonTypes: SelectOption<ButtonType>[];
  quickReplyButtonEntries: ButtonEntry[];
  quickReplyTypeOptions: SelectOption[];
  urlTypeOptions: SelectOption[];
  voiceCallTtlOptions: SelectOption<number>[];
}>();

const emit = defineEmits<{
  addButton: [type: ButtonType];
  insertUrlVariable: [button: ButtonDraft];
  removeButton: [index: number];
}>();

const draft = defineModel<TemplateDraft>({ required: true });
const { t } = useI18n();
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

      <VMenu>
        <template #activator="{ props: menuProps }">
          <VBtn
            v-bind="menuProps"
            variant="outlined"
            prepend-icon="tabler-plus"
            append-icon="tabler-chevron-down"
            :disabled="draft.buttons.length >= 10"
          >
            {{ t('whatsapp_template_add_button') }}
          </VBtn>
        </template>
        <VList density="compact">
          <VListItem
            v-for="option in marketingStandardButtonTypes"
            :key="option.value"
            @click="emit('addButton', option.value)"
          >
            <template #prepend>
              <VIcon :icon="getButtonIcon(option.value)" size="18" />
            </template>
            <VListItemTitle>{{ option.title }}</VListItemTitle>
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
      >
        <AppSelect
          v-model="entry.button.quick_reply_type"
          :label="t('whatsapp_template_button_type_label')"
          :items="quickReplyTypeOptions"
          item-title="title"
          item-value="value"
        />
        <AppTextField
          v-model="entry.button.text"
          :label="t('whatsapp_template_button_text_label')"
          maxlength="40"
          :counter="40"
          :error-messages="buttonFieldErrors(entry.button, 'text')"
        />
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
      >
        <div class="template-editor__cta-grid">
          <AppSelect
            v-model="entry.button.type"
            :label="t('whatsapp_template_action_type_label')"
            :items="ctaButtonTypes"
            item-title="title"
            item-value="value"
          />

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
              v-model="entry.button.url_type"
              :label="t('whatsapp_template_url_type_label')"
              :items="urlTypeOptions"
              item-title="title"
              item-value="value"
            />
            <AppTextField
              v-model="entry.button.url"
              :label="t('whatsapp_template_website_url_label')"
              :placeholder="t('whatsapp_template_website_url_placeholder')"
              maxlength="2000"
              :counter="2000"
              :error-messages="buttonFieldErrors(entry.button, 'url')"
            >
              <template #append-inner>
                <VBtn
                  v-if="entry.button.url_type === 'DYNAMIC'"
                  variant="text"
                  size="x-small"
                  @click.stop="emit('insertUrlVariable', entry.button)"
                >
                  {{ t('whatsapp_template_url_variable') }}
                </VBtn>
              </template>
            </AppTextField>
            <AppTextField
              v-if="
                entry.button.url_type === 'DYNAMIC' ||
                entry.button.url.includes('{{')
              "
              v-model="entry.button.url_example"
              :label="t('whatsapp_template_url_sample_label')"
              :placeholder="t('whatsapp_template_url_sample_placeholder')"
              :error-messages="buttonFieldErrors(entry.button, 'url_example')"
            />
            <VCheckbox
              v-model="entry.button.track_app_conversions"
              :label="t('whatsapp_template_track_app_conversions')"
              hide-details
              class="template-editor__wide-field"
            />
            <div
              v-if="entry.button.track_app_conversions"
              class="template-editor__deep-link-panel"
            >
              <AppTextField
                v-model="entry.button.meta_app_id"
                :label="t('whatsapp_template_meta_app_id_label')"
                :placeholder="t('whatsapp_template_meta_app_id_placeholder')"
                :error-messages="buttonFieldErrors(entry.button, 'meta_app_id')"
              />
              <AppTextField
                v-model="entry.button.android_deep_link"
                :label="t('whatsapp_template_android_deep_link_label')"
                :placeholder="
                  t('whatsapp_template_android_deep_link_placeholder')
                "
                :error-messages="
                  buttonFieldErrors(entry.button, 'android_deep_link')
                "
              />
              <AppTextField
                v-model="entry.button.android_fallback_playstore_url"
                :label="t('whatsapp_template_android_fallback_label')"
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
            </div>
          </template>

          <template v-if="entry.button.type === 'PHONE_NUMBER'">
            <AppSelect
              v-model="entry.button.phone_country_code"
              :label="t('whatsapp_template_country_label')"
              :items="countryCodeOptions"
              item-title="title"
              item-value="value"
            />
            <AppTextField
              v-model="entry.button.phone_number"
              :label="t('whatsapp_template_phone_label')"
              :placeholder="t('whatsapp_template_phone_placeholder')"
              maxlength="20"
              :counter="20"
              :error-messages="buttonFieldErrors(entry.button, 'phone_number')"
            />
          </template>

          <template v-if="entry.button.type === 'VOICE_CALL'">
            <AppSelect
              v-model="entry.button.voice_call_ttl_minutes"
              :label="t('whatsapp_template_active_for_label')"
              :items="voiceCallTtlOptions"
              item-title="title"
              item-value="value"
            />
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
