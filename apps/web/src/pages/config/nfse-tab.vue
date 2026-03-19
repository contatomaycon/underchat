<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { useSnackbarCleanup } from '@/composables/useSnackbarCleanup';
import { requiredValidator } from '@/@webcore/utils/validators';
import { VForm } from 'vuetify/components/VForm';
import { EColor } from '@core/common/enums/EColor';
import { UpdateNfseRequest } from '@core/schema/config/updateNfse/request.schema';
import { UpdateNfseIntegrationRequest } from '@core/schema/config/updateNfseIntegration/request.schema';
import { ListNfseResponse } from '@core/schema/config/listNfse/response.schema';

const { t } = useI18n();
const settingsStore = useSettingsStore();
useSnackbarCleanup(settingsStore);

const loading = ref(false);
const saving = ref(false);
const savingIntegration = ref(false);
const uploadingCertificate = ref(false);
const refFormNfse = ref<VForm>();
const refFormNfseIntegration = ref<VForm>();

const nfse = ref<ListNfseResponse | null>(null);
const certificateFile = ref<File | File[] | null>(null);
const certificatePassword = ref('');
const certificateAccept =
  '.pfx,.p12,application/x-pkcs12,application/pkcs12,application/x-pkcs#12';

const selectedCertificateFile = computed<File | null>(() => {
  if (Array.isArray(certificateFile.value)) {
    return certificateFile.value[0] ?? null;
  }

  return certificateFile.value ?? null;
});

const integrationStatusOptions = computed(() => [
  {
    title: t('active'),
    value: true,
  },
  {
    title: t('deactivated'),
    value: false,
  },
]);

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

const integrationForm = ref<UpdateNfseIntegrationRequest>({
  integration_enabled: false,
  integration_base_url: '',
  integration_uf: '',
  integration_tenant: '',
  integration_username: '',
  integration_password: '',
});

const syncNfseForms = (result: ListNfseResponse) => {
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

  integrationForm.value = {
    integration_enabled: result.integration_enabled,
    integration_base_url: result.integration_base_url ?? '',
    integration_uf: result.integration_uf ?? '',
    integration_tenant: result.integration_tenant ?? '',
    integration_username: result.integration_username ?? '',
    integration_password: '',
  };
};

const loadNfse = async () => {
  loading.value = true;
  const result = await settingsStore.getNfse();
  if (result) {
    nfse.value = result;
    syncNfseForms(result);
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
      syncNfseForms(result);
    }
  } finally {
    saving.value = false;
  }
};

const integrationRequiredValidator = (
  value: unknown,
  messageKey: string
): string | boolean => {
  if (!integrationForm.value.integration_enabled) {
    return true;
  }

  return requiredValidator(value, t(messageKey));
};

const integrationBaseUrlValidator = (value: unknown): string | boolean => {
  if (!integrationForm.value.integration_enabled) {
    return true;
  }

  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return t('nfse_integration_base_url_required');
  }

  try {
    new URL(normalized);
  } catch {
    return t('nfse_integration_base_url_invalid');
  }

  return true;
};

const integrationUfValidator = (value: unknown): string | boolean => {
  if (!integrationForm.value.integration_enabled) {
    return true;
  }

  const normalized = String(value ?? '').trim();

  if (!normalized) {
    return t('nfse_integration_uf_required');
  }

  return /^[A-Za-z]{2}$/.test(normalized) || t('nfse_integration_uf_invalid');
};

const integrationTenantValidator = (value: unknown): string | boolean => {
  return integrationRequiredValidator(
    value,
    'nfse_integration_tenant_required'
  );
};

const integrationUsernameValidator = (value: unknown): string | boolean => {
  return integrationRequiredValidator(
    value,
    'nfse_integration_username_required'
  );
};

const integrationPasswordValidator = (value: unknown): string | boolean => {
  if (!integrationForm.value.integration_enabled) {
    return true;
  }

  const normalized = String(value ?? '').trim();

  if (normalized.length > 0) {
    return true;
  }

  if (nfse.value?.has_integration_password) {
    return true;
  }

  return t('nfse_integration_password_required');
};

const saveNfseIntegration = async () => {
  const { valid } = await refFormNfseIntegration.value!.validate();
  if (!valid) return;

  const payload: UpdateNfseIntegrationRequest = integrationForm.value
    .integration_enabled
    ? (() => {
        const integrationPassword = String(
          integrationForm.value.integration_password ?? ''
        ).trim();

        const payloadWhenEnabled: UpdateNfseIntegrationRequest = {
          integration_enabled: true,
          integration_base_url: String(
            integrationForm.value.integration_base_url ?? ''
          ).trim(),
          integration_uf: String(integrationForm.value.integration_uf ?? '')
            .trim()
            .toUpperCase(),
          integration_tenant: String(
            integrationForm.value.integration_tenant ?? ''
          ).trim(),
          integration_username: String(
            integrationForm.value.integration_username ?? ''
          ).trim(),
        };

        if (integrationPassword.length > 0) {
          payloadWhenEnabled.integration_password = integrationPassword;
        }

        return payloadWhenEnabled;
      })()
    : {
        integration_enabled: false,
      };

  try {
    savingIntegration.value = true;
    const result = await settingsStore.updateNfseIntegration(payload);
    if (result) {
      nfse.value = result;
      syncNfseForms(result);
      refFormNfseIntegration.value?.resetValidation();
    }
  } finally {
    savingIntegration.value = false;
  }
};

const formatCertificateDate = (value: string | null): string => {
  if (!value) {
    return '-';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
};

const uploadCertificateToS3 = async () => {
  if (!selectedCertificateFile.value) {
    settingsStore.showSnackbar(
      t('nfse_certificate_file_required'),
      EColor.error
    );
    return;
  }

  if (!certificatePassword.value.trim()) {
    settingsStore.showSnackbar(
      t('nfse_certificate_password_required'),
      EColor.error
    );
    return;
  }

  try {
    uploadingCertificate.value = true;
    const result = await settingsStore.uploadNfseCertificate(
      selectedCertificateFile.value,
      certificatePassword.value.trim()
    );

    if (result) {
      nfse.value = result;
      syncNfseForms(result);
      certificateFile.value = null;
      certificatePassword.value = '';
    }
  } finally {
    uploadingCertificate.value = false;
  }
};

watch(
  () => integrationForm.value.integration_uf,
  (value) => {
    if (typeof value !== 'string') {
      return;
    }

    const uppercased = value.toUpperCase();

    if (value !== uppercased) {
      integrationForm.value.integration_uf = uppercased;
    }
  }
);

watch(
  () => integrationForm.value.integration_enabled,
  (enabled) => {
    if (!enabled) {
      integrationForm.value.integration_password = '';
    }
  }
);

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
                  <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
                  <AppTextField
                    v-model="form.name"
                    :rules="[requiredValidator(form.name, $t('name_required'))]"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('municipal_service_code') }}:</VLabel
                  >
                  <AppTextField v-model="form.municipal_service_code" />
                </VCol>

                <VCol cols="12">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('municipal_service_description_field') }}:</VLabel
                  >
                  <AppTextField
                    v-model="form.municipal_service_description_field"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('retain_iss') }}:</VLabel
                  >
                  <VSwitch v-model="form.retain_iss" color="primary" />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('iss_value') }}:</VLabel
                  >
                  <AppTextField
                    v-model="form.iss_value"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('cofins_value') }}:</VLabel
                  >
                  <AppTextField
                    v-model="form.cofins_value"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('csll_value') }}:</VLabel
                  >
                  <AppTextField
                    v-model="form.csll_value"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('inss_value') }}:</VLabel
                  >
                  <AppTextField
                    v-model="form.inss_value"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('ir_value') }}:</VLabel
                  >
                  <AppTextField
                    v-model="form.ir_value"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('pis_value') }}:</VLabel
                  >
                  <AppTextField
                    v-model="form.pis_value"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol cols="12" md="6">
                  <VLabel class="text-body-2 mb-1"
                    >{{ $t('deductions') }}:</VLabel
                  >
                  <AppTextField
                    v-model="form.deductions"
                    type="number"
                    step="0.00001"
                  />
                </VCol>

                <VCol
                  cols="12"
                  class="d-flex justify-end flex-wrap gap-3 mt-2 pt-2"
                >
                  <VBtn type="submit" :loading="saving" :disabled="saving">
                    {{ $t('save') }}
                  </VBtn>
                </VCol>
              </VRow>
            </VForm>

            <VDivider class="my-2" />

            <VForm
              ref="refFormNfseIntegration"
              @submit.prevent="saveNfseIntegration"
            >
              <VRow>
                <VCol cols="12">
                  <div class="text-subtitle-1">
                    {{ $t('nfse_integration') }}
                  </div>
                </VCol>

                <VCol cols="12" md="4">
                  <VLabel class="text-body-2 mb-1">
                    {{ $t('nfse_integration_status') }}:
                  </VLabel>
                  <AppSelect
                    v-model="integrationForm.integration_enabled"
                    :items="integrationStatusOptions"
                    item-title="title"
                    item-value="value"
                    :disabled="savingIntegration"
                  />
                </VCol>

                <VCol
                  v-if="integrationForm.integration_enabled"
                  cols="12"
                  md="8"
                />

                <template v-if="integrationForm.integration_enabled">
                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">
                      {{ $t('nfse_integration_base_url') }}:
                    </VLabel>
                    <AppTextField
                      v-model="integrationForm.integration_base_url"
                      :placeholder="$t('nfse_integration_base_url_placeholder')"
                      :rules="[integrationBaseUrlValidator]"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">
                      {{ $t('nfse_integration_uf') }}:
                    </VLabel>
                    <AppTextField
                      v-model="integrationForm.integration_uf"
                      maxlength="2"
                      :rules="[integrationUfValidator]"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">
                      {{ $t('nfse_integration_tenant') }}:
                    </VLabel>
                    <AppTextField
                      v-model="integrationForm.integration_tenant"
                      :rules="[integrationTenantValidator]"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">
                      {{ $t('nfse_integration_username') }}:
                    </VLabel>
                    <AppTextField
                      v-model="integrationForm.integration_username"
                      :rules="[integrationUsernameValidator]"
                    />
                  </VCol>

                  <VCol cols="12" md="6">
                    <VLabel class="text-body-2 mb-1">
                      {{ $t('nfse_integration_password') }}:
                    </VLabel>
                    <AppTextField
                      v-model="integrationForm.integration_password"
                      type="password"
                      :placeholder="$t('password')"
                      :rules="[integrationPasswordValidator]"
                    />
                  </VCol>
                </template>

                <VCol
                  cols="12"
                  class="d-flex justify-end flex-wrap gap-3 mt-2 pt-2"
                >
                  <VBtn
                    type="submit"
                    color="secondary"
                    :loading="savingIntegration"
                    :disabled="savingIntegration"
                  >
                    {{ $t('nfse_integration_save') }}
                  </VBtn>
                </VCol>

                <VCol cols="12" class="d-flex flex-column gap-1">
                  <span class="text-body-2">
                    {{ $t('nfse_integration_current_status') }}:
                    {{
                      nfse?.integration_enabled
                        ? $t('active')
                        : $t('deactivated')
                    }}
                  </span>
                  <span class="text-body-2">
                    {{
                      nfse?.has_integration_password
                        ? $t('nfse_integration_password_saved')
                        : $t('nfse_integration_password_not_saved')
                    }}
                  </span>
                </VCol>
              </VRow>
            </VForm>

            <VDivider class="my-2" />

            <VRow>
              <VCol cols="12">
                <div class="text-subtitle-1">
                  {{ $t('nfse_digital_certificate') }}
                </div>
              </VCol>

              <VCol cols="12" md="6">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('nfse_certificate_file') }}:</VLabel
                >
                <VFileInput
                  v-model="certificateFile"
                  :accept="certificateAccept"
                  :placeholder="$t('select_file')"
                  :prepend-icon="''"
                  show-size
                  clearable
                  hide-details="auto"
                >
                  <template #prepend-inner>
                    <VIcon icon="tabler-upload" />
                  </template>
                </VFileInput>
                <small class="text-caption text-medium-emphasis mt-1 d-block">
                  {{ $t('nfse_certificate_allowed_formats') }}
                </small>
              </VCol>

              <VCol cols="12" md="6">
                <VLabel class="text-body-2 mb-1"
                  >{{ $t('nfse_certificate_password') }}:</VLabel
                >
                <AppTextField
                  v-model="certificatePassword"
                  type="password"
                  :placeholder="$t('password')"
                />
              </VCol>

              <VCol cols="12">
                <VBtn
                  type="button"
                  color="secondary"
                  :loading="uploadingCertificate"
                  :disabled="
                    uploadingCertificate ||
                    !selectedCertificateFile ||
                    !certificatePassword.trim()
                  "
                  @click="uploadCertificateToS3"
                >
                  {{ $t('nfse_certificate_upload_to_s3') }}
                </VBtn>
              </VCol>

              <VCol cols="12" class="d-flex flex-column gap-1">
                <span class="text-body-2">
                  {{
                    nfse?.has_certificate
                      ? `${$t('nfse_certificate_current_file')}: ${nfse?.certificate_file_name ?? '-'}`
                      : $t('nfse_certificate_not_uploaded')
                  }}
                </span>
                <span v-if="nfse?.has_certificate" class="text-body-2">
                  {{ $t('nfse_certificate_uploaded_at') }}:
                  {{
                    formatCertificateDate(nfse?.certificate_uploaded_at ?? null)
                  }}
                </span>
                <span v-if="nfse?.has_certificate" class="text-body-2">
                  {{
                    nfse?.has_certificate_password
                      ? $t('nfse_certificate_password_saved')
                      : $t('nfse_certificate_password_not_saved')
                  }}
                </span>
              </VCol>
            </VRow>
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
