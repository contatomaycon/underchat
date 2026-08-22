<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useIntegrationStore } from '@/@webcore/stores/integration';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import AppWebhookMappingModal from './AppWebhookMappingModal.vue';

const { t } = useI18n();
const integrationStore = useIntegrationStore();

const props = defineProps<{
  modelValue: boolean;
  apiKeyId: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  closed: [];
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const isWebhookMappingModalOpen = ref(false);

const permissionsUpdateStatus = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
  EIntegrationPermissions.integration_status_update,
];
const permissionsGenerateKey = [
  EGeneralPermissions.full_access,
  EGeneralPermissions.full_access_group,
  EIntegrationPermissions.integration_group,
  EIntegrationPermissions.integration_generate_key,
];

const currentIntegration = computed(() => integrationStore.currentIntegration);

const isActive = computed(() => {
  return currentIntegration.value?.status === EStatusApiKey.active;
});

const webhookUrl = computed(() => {
  if (!isActive.value || !currentIntegration.value?.key) {
    return null;
  }

  const baseUrl = import.meta.env.VITE_API_PUBLIC_URL || '';
  return `${baseUrl}/v1/webhook/${currentIntegration.value.key}`;
});

const handleToggleStatus = async () => {
  if (!props.apiKeyId) {
    return;
  }

  const newStatus = isActive.value
    ? EStatusApiKey.inactive
    : EStatusApiKey.active;

  await integrationStore.updateIntegrationStatus(props.apiKeyId, newStatus);
  await integrationStore.viewIntegrationById(props.apiKeyId);
};

const handleGenerateKey = async () => {
  if (!props.apiKeyId) {
    return;
  }

  await integrationStore.generateIntegrationKey(props.apiKeyId);
  await integrationStore.viewIntegrationById(props.apiKeyId);
};

const copyWebhookUrl = async () => {
  if (webhookUrl.value) {
    try {
      await globalThis.navigator.clipboard.writeText(webhookUrl.value);
    } catch (error) {
      console.error('Erro ao copiar URL do webhook:', error);
    }
  }
};

const copyIntegrationKey = async () => {
  if (currentIntegration.value?.key) {
    try {
      await globalThis.navigator.clipboard.writeText(
        currentIntegration.value.key
      );
    } catch (error) {
      console.error('Erro ao copiar chave de integração:', error);
    }
  }
};

const handleClosed = () => {
  isVisible.value = false;
  emit('closed');
};

watch(
  () => props.apiKeyId,
  async (apiKeyId) => {
    if (apiKeyId && isVisible.value) {
      await integrationStore.viewIntegrationById(apiKeyId);
    }
  },
  { immediate: true }
);

watch(isVisible, async (visible) => {
  if (visible && props.apiKeyId) {
    await integrationStore.viewIntegrationById(props.apiKeyId);
  }
});

onMounted(async () => {
  if (isVisible.value && props.apiKeyId) {
    await integrationStore.viewIntegrationById(props.apiKeyId);
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="800" persistent>
    <DialogCloseBtn @click="handleClosed" />

    <VCard>
      <VCardTitle class="d-flex align-center mb-4">
        <VIcon icon="tabler-settings" class="me-2" />
        {{ $t('configure_integration') }}
      </VCardTitle>

      <VCardText>
        <VRow v-if="integrationStore.loading">
          <VCol cols="12">
            <VSkeletonLoader type="text" width="120" height="20" class="mb-2" />
            <VSkeletonLoader type="chip" width="100" height="32" />
          </VCol>
        </VRow>

        <VRow v-else-if="!currentIntegration">
          <VCol cols="12">
            <VAlert type="error">
              {{ $t('integration_not_found') }}
            </VAlert>
          </VCol>
        </VRow>

        <template v-else>
          <VRow>
            <VCol cols="12" md="6">
              <div class="text-body-2 text-medium-emphasis mb-2">
                {{ $t('integration_status') }}
              </div>
              <VChip
                :color="isActive ? 'success' : 'error'"
                variant="tonal"
                class="mb-4"
              >
                {{
                  isActive
                    ? $t('integration_status_active')
                    : $t('integration_status_inactive')
                }}
              </VChip>
            </VCol>

            <VCol cols="12" md="6" class="text-end">
              <VBtn
                v-if="$canPermission(permissionsUpdateStatus)"
                :color="isActive ? 'error' : 'success'"
                @click="handleToggleStatus"
              >
                {{
                  isActive
                    ? $t('integration_deactivate')
                    : $t('integration_activate')
                }}
              </VBtn>
            </VCol>
          </VRow>

          <VDivider class="my-4" />

          <VRow v-if="isActive && webhookUrl">
            <VCol cols="12">
              <div class="text-body-2 text-medium-emphasis mb-2">
                {{ $t('integration_webhook_endpoint') }}
              </div>
              <VTextField
                :model-value="webhookUrl"
                readonly
                variant="outlined"
                density="compact"
                class="mb-2"
              >
                <template #append-inner>
                  <VBtn
                    icon="tabler-copy"
                    variant="text"
                    size="small"
                    @click="copyWebhookUrl"
                  />
                </template>
              </VTextField>

              <VAlert type="info" variant="tonal" class="mt-4">
                <div class="text-body-2">
                  {{ $t('integration_webhook_info') }}
                </div>
                <div class="text-body-2 mt-2">
                  <strong>{{ $t('integration_webhook_url') }}</strong>
                  {{ $t('integration_webhook_url_example') }}
                </div>
              </VAlert>
            </VCol>
          </VRow>

          <VDivider class="my-4" />

          <VRow>
            <VCol cols="12">
              <div class="text-body-2 text-medium-emphasis mb-2">
                {{ $t('integration_key') }}
              </div>
              <VTextField
                :model-value="currentIntegration.key"
                readonly
                variant="outlined"
                density="compact"
                type="password"
                class="mb-2"
              >
                <template #append-inner>
                  <VBtn
                    icon="tabler-copy"
                    variant="text"
                    size="small"
                    @click="copyIntegrationKey"
                  />
                </template>
              </VTextField>

              <VBtn
                v-if="$canPermission(permissionsGenerateKey)"
                color="primary"
                variant="outlined"
                @click="handleGenerateKey"
              >
                {{ $t('integration_generate_new_key') }}
              </VBtn>
            </VCol>
          </VRow>

          <VDivider class="my-4" v-if="isActive" />

          <VRow v-if="isActive">
            <VCol cols="12">
              <VCard variant="outlined">
                <VCardText>
                  <div class="d-flex justify-space-between align-center">
                    <div>
                      <div class="text-h6 mb-1">
                        {{ $t('integration_webhook_mapping') }}
                      </div>
                      <div class="text-body-2 text-medium-emphasis">
                        {{ $t('integration_webhook_mapping_description') }}
                      </div>
                    </div>
                    <VBtn
                      color="primary"
                      @click="isWebhookMappingModalOpen = true"
                    >
                      {{ $t('configure') }}
                    </VBtn>
                  </div>
                </VCardText>
              </VCard>
            </VCol>
          </VRow>
        </template>
      </VCardText>

      <VCardActions>
        <VSpacer />
        <VBtn variant="tonal" color="secondary" @click="handleClosed">
          {{ $t('close') }}
        </VBtn>
      </VCardActions>
    </VCard>
  </VDialog>

  <AppWebhookMappingModal
    v-model="isWebhookMappingModalOpen"
    :api-key-id="apiKeyId"
  />
</template>
