<script setup lang="ts">
import { reactive, computed, watch, ref, onMounted } from 'vue';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { VForm } from 'vuetify/components/VForm';
import { EColor } from '@core/common/enums/EColor';

const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const formRef = ref<VForm>();
const isSaving = ref(false);

const form = reactive({
  app_id: '',
  app_secret: '',
  webhook_verify_token: '',
  configuration_id: '',
  api_version: '',
});

const hasSecret = computed(
  () => settingsStore.whatsappEmbeddedConfig?.has_app_secret === true
);

const loadConfig = async () => {
  const config = await settingsStore.getWhatsappEmbeddedConfig();

  if (!config) {
    return;
  }

  form.app_id = config.app_id ?? '';
  form.configuration_id = config.configuration_id ?? '';
  form.api_version = config.api_version ?? '';
  form.webhook_verify_token = config.webhook_verify_token ?? '';
  form.app_secret = '';
};

const generateWebhookVerifyToken = () => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    ''
  );
  form.webhook_verify_token = btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
};

const copyWebhookVerifyToken = async () => {
  if (!form.webhook_verify_token) {
    return;
  }

  await navigator.clipboard.writeText(form.webhook_verify_token);
  settingsStore.showSnackbar(
    settingsStore.i18n.global.t('whatsapp_webhook_token_copied'),
    EColor.success
  );
};

const saveConfig = async () => {
  const validation = await formRef.value?.validate();
  if (!validation?.valid) {
    return;
  }

  isSaving.value = true;
  try {
    await settingsStore.updateWhatsappEmbeddedConfig({
      app_id: form.app_id,
      app_secret: form.app_secret || null,
      webhook_verify_token: form.webhook_verify_token || null,
      configuration_id: form.configuration_id,
      api_version: form.api_version,
    });
    form.app_secret = '';
  } finally {
    isSaving.value = false;
  }
};

watch(
  () => settingsStore.whatsappEmbeddedConfig,
  (config) => {
    if (!config) {
      return;
    }

    form.app_id = config.app_id ?? '';
    form.configuration_id = config.configuration_id ?? '';
    form.api_version = config.api_version ?? '';
    form.webhook_verify_token = config.webhook_verify_token ?? '';
  }
);

onMounted(loadConfig);
</script>

<template>
  <VCard>
    <VCardTitle class="text-h6 pa-6 pb-4">
      {{ $t('whatsapp_embedded') }}
    </VCardTitle>

    <VDivider />

    <VCardText>
      <VForm ref="formRef" @submit.prevent="saveConfig">
        <VRow>
          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">
              {{ $t('whatsapp_app_id') }}
            </VLabel>
            <AppTextField
              v-model="form.app_id"
              :placeholder="$t('whatsapp_app_id')"
              :rules="[requiredValidator(form.app_id, $t('field_required'))]"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">
              {{ $t('whatsapp_app_secret') }}
            </VLabel>
            <AppTextField
              v-model="form.app_secret"
              type="password"
              :placeholder="
                hasSecret
                  ? $t('whatsapp_app_secret_keep_placeholder')
                  : $t('whatsapp_app_secret')
              "
              :rules="
                hasSecret
                  ? []
                  : [requiredValidator(form.app_secret, $t('field_required'))]
              "
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">
              {{ $t('whatsapp_configuration_id') }}
            </VLabel>
            <AppTextField
              v-model="form.configuration_id"
              :placeholder="$t('whatsapp_configuration_id')"
              :rules="[
                requiredValidator(form.configuration_id, $t('field_required')),
              ]"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">
              {{ $t('whatsapp_api_version') }}
            </VLabel>
            <AppTextField
              v-model="form.api_version"
              placeholder="vXX.X"
              :rules="[
                requiredValidator(form.api_version, $t('field_required')),
              ]"
            />
          </VCol>

          <VCol cols="12" md="6">
            <VLabel class="text-body-2 mb-1">
              {{ $t('whatsapp_webhook_verify_token') }}
            </VLabel>
            <AppTextField
              v-model="form.webhook_verify_token"
              :placeholder="$t('whatsapp_webhook_verify_token_placeholder')"
            >
              <template #append-inner>
                <div class="d-flex align-center ga-1">
                  <VBtn
                    type="button"
                    icon
                    variant="text"
                    size="small"
                    :aria-label="$t('whatsapp_generate_webhook_token')"
                    @click.stop="generateWebhookVerifyToken"
                  >
                    <VIcon size="18">tabler-key</VIcon>
                    <VTooltip activator="parent" location="top">
                      {{ $t('whatsapp_generate_webhook_token') }}
                    </VTooltip>
                  </VBtn>
                  <VBtn
                    type="button"
                    icon
                    variant="text"
                    size="small"
                    :disabled="!form.webhook_verify_token"
                    :aria-label="$t('whatsapp_copy_webhook_token')"
                    @click.stop="copyWebhookVerifyToken"
                  >
                    <VIcon size="18">tabler-copy</VIcon>
                    <VTooltip activator="parent" location="top">
                      {{ $t('whatsapp_copy_webhook_token') }}
                    </VTooltip>
                  </VBtn>
                </div>
              </template>
            </AppTextField>
          </VCol>
        </VRow>

        <div class="d-flex justify-end mt-6">
          <VBtn type="submit" :loading="isSaving || settingsStore.loading">
            {{ $t('save') }}
          </VBtn>
        </div>
      </VForm>
    </VCardText>
  </VCard>
</template>
