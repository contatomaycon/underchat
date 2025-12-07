<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';

const { t } = useI18n();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const saving = ref(false);
const refFormNfse = ref<VForm>();

const nfse = ref<ListNfseResponse | null>(null);

const form = ref<UpdateNfseRequest>({
  name: '',
  municipal_service_code: undefined,
  municipal_service_description_field: undefined,
  retain_iss: false,
  iss_value: undefined,
  cofins_value: undefined,
  csll_value: undefined,
  inss_value: undefined,
  ir_value: undefined,
  pis_value: undefined,
  deductions: undefined,
});

const loadNfse = async () => {
  loading.value = true;
  const result = await settingsStore.getNfse();
  if (result) {
    nfse.value = result;
    form.value = {
      name: result.name,
      municipal_service_code: result.municipal_service_code,
      municipal_service_description_field:
        result.municipal_service_description_field,
      retain_iss: result.retain_iss,
      iss_value: result.iss_value,
      cofins_value: result.cofins_value,
      csll_value: result.csll_value,
      inss_value: result.inss_value,
      ir_value: result.ir_value,
      pis_value: result.pis_value,
      deductions: result.deductions,
    };
  }
  loading.value = false;
};

const saveNfse = async () => {
  const { valid } = await refFormNfse.value!.validate();
  if (!valid) return;

  try {
    saving.value = true;
    const result = await settingsStore.updateNfse(form.value);
    if (result) {
      nfse.value = result;
    }
  } finally {
    saving.value = false;
  }
};

onMounted(() => {
  loadNfse();
});
</script>

<template>
  <div>
    <VRow v-if="loading">
      <VCol cols="12" class="text-center">
        <VProgressCircular indeterminate color="primary" />
      </VCol>
    </VRow>

    <VRow v-else>
      <VCol cols="12">
        <VCard>
          <VCardTitle class="text-h6 pa-6 pb-4">
            {{ $t('nfse') }}
          </VCardTitle>

          <VDivider />

          <VCardText>
            <VForm ref="refFormNfse" @submit.prevent="saveNfse">
              <VRow>
                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.name"
                    :label="$t('name')"
                    :rules="[requiredValidator(form.name, $t('name_required'))]"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.municipal_service_code"
                    :label="$t('municipal_service_code')"
                  />
                </VCol>

                <VCol cols="12">
                  <AppTextField
                    v-model="form.municipal_service_description_field"
                    :label="$t('municipal_service_description_field')"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VSwitch
                    v-model="form.retain_iss"
                    :label="$t('retain_iss')"
                    color="primary"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.iss_value"
                    :label="$t('iss_value')"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.cofins_value"
                    :label="$t('cofins_value')"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.csll_value"
                    :label="$t('csll_value')"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.inss_value"
                    :label="$t('inss_value')"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.ir_value"
                    :label="$t('ir_value')"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.pis_value"
                    :label="$t('pis_value')"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <AppTextField
                    v-model="form.deductions"
                    :label="$t('deductions')"
                    type="number"
                    step="0.00001"
                  />
                </VCol>
              </VRow>

              <VCardText class="d-flex justify-end flex-wrap gap-3 mt-4 pt-4">
                <VBtn type="submit" :loading="saving" :disabled="saving">
                  {{ $t('save') }}
                </VBtn>
              </VCardText>
            </VForm>
          </VCardText>
        </VCard>
      </VCol>
    </VRow>

    <VSnackbar
      v-model="settingsStore.snackbar.status"
      transition="scroll-y-reverse-transition"
      location="top end"
      :color="settingsStore.snackbar.color"
    >
      {{ settingsStore.snackbar.message }}
    </VSnackbar>
  </div>
</template>
