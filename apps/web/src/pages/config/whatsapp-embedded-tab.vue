<script setup lang="ts">
import { reactive, computed, watch, ref, onMounted } from 'vue';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { VForm } from 'vuetify/components/VForm';

const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const formRef = ref<VForm>();
const isSaving = ref(false);

const form = reactive({
  app_id: '',
  app_secret: '',
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
  form.app_secret = '';
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
