<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useIntegrationStore } from '@/@webcore/stores/integration';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { useCountryCodes } from '@/composables/useCountryCodes';

const { t } = useI18n();
const integrationStore = useIntegrationStore();
const { items: countryCodesItems } = useCountryCodes();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const webhookMapping = ref<Record<string, string | null>>({});
const webhookDataKeys = ref<string[]>([]);
const phoneDdiMode = ref<'depara' | 'select'>('select');
const messageMode = ref<'textarea' | 'depara'>('textarea');

const availableTags = computed(() => [
  {
    tag: '{{ greeting }}',
    description: t('tag_greeting_description'),
  },
  {
    tag: '{{ name }}',
    description: t('tag_name_description'),
  },
  {
    tag: '{{ protocol }}',
    description: t('tag_protocol_description'),
  },
  {
    tag: '{{ date }}',
    description: t('tag_date_description'),
  },
  {
    tag: '{{ time }}',
    description: t('tag_time_description'),
  },
  {
    tag: '{{ account_name }}',
    description: t('tag_account_name_description'),
  },
  {
    tag: '{{ phone }}',
    description: t('tag_phone_description'),
  },
  {
    tag: '{{ channel_name }}',
    description: t('tag_channel_name_description'),
  },
]);
const expectedFields = computed(() => [
  { key: 'first_name', label: t('webhook_field_first_name'), required: true },
  { key: 'last_name', label: t('webhook_field_last_name'), required: false },
  { key: 'nickname', label: t('webhook_field_nickname'), required: false },
  { key: 'birthday', label: t('webhook_field_birthday'), required: false },
  { key: 'email', label: t('webhook_field_email'), required: false },
  { key: 'phone_ddi', label: t('webhook_field_phone_ddi'), required: true },
  { key: 'phone', label: t('webhook_field_phone'), required: true },
  { key: 'notes', label: t('webhook_field_notes'), required: false },
  { key: 'labels', label: t('webhook_field_labels'), required: false },
  { key: 'message', label: t('webhook_field_message'), required: false },
]);

const extractNestedKeys = (
  obj: unknown,
  prefix = '',
  keys: string[] = []
): string[] => {
  if (obj === null || obj === undefined) {
    return keys;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return keys;
    }

    for (let i = 0; i < obj.length; i++) {
      const currentKey = prefix ? `${prefix}[${i}]` : `[${i}]`;
      extractNestedKeys(obj[i], currentKey, keys);
    }

    return keys;
  }

  if (typeof obj === 'object') {
    const record = obj as Record<string, unknown>;

    for (const key in record) {
      const currentKey = prefix ? `${prefix}.${key}` : key;
      const value = record[key];

      if (
        value === null ||
        value === undefined ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        keys.push(currentKey);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          keys.push(currentKey);
        } else {
          extractNestedKeys(value, currentKey, keys);
        }
      } else if (typeof value === 'object') {
        extractNestedKeys(value, currentKey, keys);
      }
    }

    return keys;
  }

  return keys;
};

const loadWebhookData = async () => {
  await integrationStore.viewWebhookData();

  if (integrationStore.webhookData) {
    const allKeys = extractNestedKeys(integrationStore.webhookData);
    webhookDataKeys.value = allKeys.filter((key) => key !== 'account_id');
  }
};

const loadWebhookMapping = async () => {
  await integrationStore.viewWebhookMapping();

  if (integrationStore.webhookMapping) {
    webhookMapping.value = integrationStore.webhookMapping.mapping || {};
  } else {
    webhookMapping.value = {};
  }

  expectedFields.value.forEach((field) => {
    if (webhookMapping.value[field.key] === undefined) {
      webhookMapping.value[field.key] = null;
    }
  });
};

type SelectValue = string | number | boolean | null;

const handleFieldUpdate = (
  fieldKey: string,
  value: SelectValue | SelectValue[]
): void => {
  if (typeof value === 'string') {
    webhookMapping.value[fieldKey] = value;
  } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') {
    webhookMapping.value[fieldKey] = value[0];
  } else {
    webhookMapping.value[fieldKey] = null;
  }
};

const handleSaveMapping = async () => {
  const mappingToSave: Record<string, string> = {};

  for (const key in webhookMapping.value) {
    const value = webhookMapping.value[key];
    if (value !== null && value !== undefined) {
      mappingToSave[key] = value;
    }
  }

  const success = await integrationStore.saveWebhookMapping(mappingToSave);

  if (success) {
    isOpen.value = false;
  }
};

watch(isOpen, async (newValue) => {
  if (newValue) {
    webhookMapping.value = {};
    webhookDataKeys.value = [];
    phoneDdiMode.value = 'select';
    messageMode.value = 'textarea';

    expectedFields.value.forEach((field) => {
      if (field.key === 'phone_ddi') {
        webhookMapping.value[field.key] = '55';
      } else {
        webhookMapping.value[field.key] = null;
      }
    });

    await Promise.all([loadWebhookData(), loadWebhookMapping()]);

    if (
      webhookMapping.value.phone_ddi &&
      !webhookDataKeys.value.includes(webhookMapping.value.phone_ddi)
    ) {
      phoneDdiMode.value = 'select';
    } else if (
      webhookMapping.value.phone_ddi &&
      webhookDataKeys.value.includes(webhookMapping.value.phone_ddi)
    ) {
      phoneDdiMode.value = 'depara';
    } else if (!webhookMapping.value.phone_ddi) {
      webhookMapping.value.phone_ddi = '55';
    }

    if (
      webhookMapping.value.message &&
      webhookDataKeys.value.includes(webhookMapping.value.message)
    ) {
      messageMode.value = 'depara';
    }
  }
});
</script>

<template>
  <VDialog v-model="isOpen" max-width="800" persistent>
    <DialogCloseBtn @click="isOpen = false" />

    <VCard :title="$t('integration_webhook_mapping')">
      <VCardText>
        <VRow v-if="integrationStore.webhookDataLoading">
          <VCol cols="12">
            <div v-for="field in expectedFields" :key="field.key" class="mb-4">
              <VSkeletonLoader
                type="text"
                width="120"
                height="20"
                class="mb-2"
              />
              <VSkeletonLoader type="text" height="56" />
            </div>
          </VCol>
        </VRow>

        <VRow v-else-if="webhookDataKeys.length === 0">
          <VCol cols="12">
            <div class="d-flex flex-column align-center justify-center py-12">
              <VAvatar
                size="120"
                color="primary"
                variant="tonal"
                class="mb-6"
              >
                <VIcon icon="tabler-webhook" size="64" />
              </VAvatar>
              <h3 class="text-h5 mb-2">
                {{ $t('integration_webhook_mapping_empty') }}
              </h3>
              <p class="text-body-1 text-medium-emphasis text-center max-width-400">
                {{ $t('integration_webhook_mapping_empty_description') }}
              </p>
            </div>
          </VCol>
        </VRow>

        <VRow v-else>
          <VCol cols="12">
            <div v-for="field in expectedFields" :key="field.key" class="mb-4">
              <div
                v-if="field.key === 'phone_ddi'"
                class="d-flex align-center justify-space-between mb-2"
              >
                <VLabel class="text-body-2">
                  {{ field.label }}
                  <span v-if="field.required" class="text-error">*</span>
                </VLabel>
                <VBtn
                  variant="text"
                  size="small"
                  density="compact"
                  @click="phoneDdiMode = phoneDdiMode === 'select' ? 'depara' : 'select'"
                >
                  {{
                    phoneDdiMode === 'select'
                      ? $t('use_mapping')
                      : $t('use_ddi_list')
                  }}
                </VBtn>
              </div>
              <div
                v-else-if="field.key === 'message'"
                class="d-flex align-center justify-space-between mb-2"
              >
                <VLabel class="text-body-2">
                  {{ field.label }}
                  <span v-if="field.required" class="text-error">*</span>
                </VLabel>
                <VBtn
                  variant="text"
                  size="small"
                  density="compact"
                  @click="messageMode = messageMode === 'textarea' ? 'depara' : 'textarea'"
                >
                  {{
                    messageMode === 'textarea'
                      ? $t('use_mapping')
                      : $t('use_textarea')
                  }}
                </VBtn>
              </div>
              <VLabel
                v-else
                class="text-body-2 mb-2"
              >
                {{ field.label }}
                <span v-if="field.required" class="text-error">*</span>
              </VLabel>
              <AppSelectSearch
                v-if="field.key === 'phone_ddi' && phoneDdiMode === 'depara'"
                :model-value="webhookMapping[field.key] ?? null"
                @update:model-value="handleFieldUpdate(field.key, $event)"
                :items="
                  webhookDataKeys.map((key) => ({
                    value: key,
                    title: key,
                  }))
                "
                :placeholder="$t('select_field')"
                :clearable="!field.required"
                item-value="value"
                item-title="title"
              />
              <AppSelectSearch
                v-else-if="field.key === 'phone_ddi' && phoneDdiMode === 'select'"
                :model-value="webhookMapping[field.key] ?? null"
                @update:model-value="handleFieldUpdate(field.key, $event)"
                :items="countryCodesItems"
                :placeholder="$t('select_phone_ddi')"
                :clearable="!field.required"
                item-value="value"
                item-title="title"
              />
              <div v-else-if="field.key === 'message' && messageMode === 'textarea'">
                <VTextarea
                  :model-value="webhookMapping[field.key] ?? ''"
                  @update:model-value="webhookMapping[field.key] = $event || null"
                  :placeholder="$t('webhook_field_message')"
                  rows="4"
                />
                <VExpansionPanels variant="accordion" class="mt-2">
                  <VExpansionPanel>
                    <VExpansionPanelTitle>
                      <span class="text-caption">{{ $t('available_tags') }}</span>
                    </VExpansionPanelTitle>
                    <VExpansionPanelText>
                      <div class="d-flex flex-column gap-1">
                        <div
                          v-for="tag in availableTags"
                          :key="tag.tag"
                          class="text-caption"
                        >
                          <code>{{ tag.tag }}</code
                          >: {{ tag.description }}
                        </div>
                      </div>
                    </VExpansionPanelText>
                  </VExpansionPanel>
                </VExpansionPanels>
              </div>
              <AppSelectSearch
                v-else-if="field.key === 'message' && messageMode === 'depara'"
                :model-value="webhookMapping[field.key] ?? null"
                @update:model-value="handleFieldUpdate(field.key, $event)"
                :items="
                  webhookDataKeys.map((key) => ({
                    value: key,
                    title: key,
                  }))
                "
                :placeholder="$t('select_field')"
                :clearable="!field.required"
                item-value="value"
                item-title="title"
              />
              <AppSelectSearch
                v-else
                :model-value="webhookMapping[field.key] ?? null"
                @update:model-value="handleFieldUpdate(field.key, $event)"
                :items="
                  webhookDataKeys.map((key) => ({
                    value: key,
                    title: key,
                  }))
                "
                :placeholder="$t('select_field')"
                :clearable="!field.required"
                item-value="value"
                item-title="title"
              />
            </div>
          </VCol>
        </VRow>
      </VCardText>

      <VDivider />

      <VCardText class="d-flex justify-end gap-3 flex-wrap">
        <VBtn variant="tonal" color="secondary" @click="isOpen = false">
          {{ $t('cancel') }}
        </VBtn>
        <VBtn
          v-if="webhookDataKeys.length > 0"
          color="primary"
          :loading="integrationStore.webhookMappingLoading"
          :disabled="
            !$canPermission([
              EGeneralPermissions.full_access,
              EGeneralPermissions.full_access_group,
              EIntegrationPermissions.integration_group,
            ])
          "
          @click="handleSaveMapping"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
