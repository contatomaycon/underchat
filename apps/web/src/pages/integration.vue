<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EIntegrationPermissions } from '@core/common/enums/EPermissions/integration';
import { useIntegrationStore } from '@/@webcore/stores/integration';
import { EStatusApiKey } from '@core/common/enums/EStatusApiKey';
import AppWebhookMappingModal from '@/components/integration/AppWebhookMappingModal.vue';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EGeneralPermissions.full_access_group,
      EIntegrationPermissions.integration_group,
    ],
  },
});

const integrationStore = useIntegrationStore();
const isWebhookMappingModalOpen = ref(false);

const isActive = computed(() => {
  return integrationStore.integration?.status === EStatusApiKey.active;
});

const webhookUrl = computed(() => {
  if (!isActive.value || !integrationStore.integration?.key) {
    return null;
  }

  const baseUrl = import.meta.env.VITE_API_PUBLIC_URL || '';
  return `${baseUrl}/v1/webhook/${integrationStore.integration.key}`;
});

const handleToggleStatus = async () => {
  const newStatus = isActive.value
    ? EStatusApiKey.inactive
    : EStatusApiKey.active;

  await integrationStore.updateIntegrationStatus(newStatus);
  await integrationStore.viewIntegration();
};

const handleGenerateKey = async () => {
  await integrationStore.generateIntegrationKey();
  await integrationStore.viewIntegration();
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
  if (integrationStore.integration?.key) {
    try {
      await globalThis.navigator.clipboard.writeText(
        integrationStore.integration.key
      );
    } catch (error) {
      console.error('Erro ao copiar chave de integração:', error);
    }
  }
};

onMounted(async () => {
  await integrationStore.viewIntegration();
});
</script>

<template>
  <VCard flat>
    <VCardTitle class="d-flex align-center mb-4">
      <VIcon icon="tabler-api" class="me-2" />
      {{ $t('integration') }}
    </VCardTitle>

    <VCardText>
      <VRow v-if="integrationStore.loading">
        <VCol cols="12">
          <VCard variant="outlined">
            <VCardText>
              <VRow>
                <VCol cols="12" md="6">
                  <VSkeletonLoader
                    type="text"
                    width="120"
                    height="20"
                    class="mb-2"
                  />
                  <VSkeletonLoader type="chip" width="100" height="32" />
                </VCol>
                <VCol cols="12" md="6" class="text-end">
                  <VSkeletonLoader type="button" width="140" height="36" />
                </VCol>
              </VRow>

              <VDivider class="my-4" />

              <VRow>
                <VCol cols="12">
                  <VSkeletonLoader
                    type="text"
                    width="150"
                    height="20"
                    class="mb-2"
                  />
                  <VSkeletonLoader type="text" height="48" />
                </VCol>
              </VRow>

              <VDivider class="my-4" />

              <VRow>
                <VCol cols="12">
                  <VSkeletonLoader
                    type="text"
                    width="130"
                    height="20"
                    class="mb-2"
                  />
                  <VSkeletonLoader type="text" height="48" class="mb-2" />
                  <VSkeletonLoader type="button" width="180" height="36" />
                </VCol>
              </VRow>
            </VCardText>
          </VCard>
        </VCol>
      </VRow>

      <VRow v-else-if="!integrationStore.integration">
        <VCol cols="12">
          <VCard variant="outlined">
            <VCardText class="text-center py-8">
              <VIcon
                icon="tabler-api-off"
                size="64"
                color="medium-emphasis"
                class="mb-4"
              />
              <div class="text-h6 mb-2">
                {{ $t('integration_not_activated') }}
              </div>
              <div class="text-body-2 text-medium-emphasis mb-6">
                {{ $t('integration_not_activated_description') }}
              </div>
              <VBtn
                color="primary"
                :disabled="
                  !$canPermission([
                    EGeneralPermissions.full_access,
                    EGeneralPermissions.full_access_group,
                    EIntegrationPermissions.integration_status_update,
                  ])
                "
                @click="handleToggleStatus"
              >
                {{ $t('integration_activate') }}
              </VBtn>
            </VCardText>
          </VCard>
        </VCol>
      </VRow>

      <VRow v-else>
        <VCol cols="12">
          <VCard variant="outlined">
            <VCardText>
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
                    :color="isActive ? 'error' : 'success'"
                    :disabled="
                      !$canPermission([
                        EGeneralPermissions.full_access,
                        EGeneralPermissions.full_access_group,
                        EIntegrationPermissions.integration_status_update,
                      ])
                    "
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
                    :model-value="integrationStore.integration.key"
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
                    color="primary"
                    variant="outlined"
                    :disabled="
                      !$canPermission([
                        EGeneralPermissions.full_access,
                        EGeneralPermissions.full_access_group,
                        EIntegrationPermissions.integration_generate_key,
                      ])
                    "
                    @click="handleGenerateKey"
                  >
                    {{ $t('integration_generate_new_key') }}
                  </VBtn>
                </VCol>
              </VRow>
            </VCardText>
          </VCard>
        </VCol>
      </VRow>

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
                  :disabled="
                    !$canPermission([
                      EGeneralPermissions.full_access,
                      EGeneralPermissions.full_access_group,
                      EIntegrationPermissions.integration_group,
                    ])
                  "
                  @click="isWebhookMappingModalOpen = true"
                >
                  {{ $t('configure_mapping') }}
                </VBtn>
              </div>
            </VCardText>
          </VCard>
        </VCol>
      </VRow>
    </VCardText>
  </VCard>

  <AppWebhookMappingModal v-model="isWebhookMappingModalOpen" />
</template>

<route lang="json">
{
  "name": "integration"
}
</route>
