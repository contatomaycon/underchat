<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { VForm } from 'vuetify/components/VForm';
import {
  betweenValidator,
  integerValidator,
} from '@/@webcore/utils/validators';
import { useWarmChannelsStore } from '@/@webcore/stores/warmChannels';
import { UpdateWarmChannelSettingsRequest } from '@core/schema/config/updateWarmChannelSettings/request.schema';
import { WarmChannelSettingsResponse } from '@core/schema/config/viewWarmChannelSettings/response.schema';

const props = defineProps<{
  modelValue: boolean;
  settings: WarmChannelSettingsResponse | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [];
}>();

const { t } = useI18n();
const warmChannelsStore = useWarmChannelsStore();
const refForm = ref<VForm>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const form = reactive<UpdateWarmChannelSettingsRequest>({
  warmup_enabled: false,
  target_ready_baileys: 2,
  target_ready_wwebjs: 2,
  target_ready_whatsmeow: 2,
  scan_interval_seconds: 30,
  reservation_ttl_seconds: 90,
  warming_stale_after_seconds: 180,
});

const targetRules = [
  (value: unknown) => integerValidator(value, t('warm_channel_integer_rule')),
  (value: unknown) =>
    betweenValidator(value, 0, 100, t('warm_channel_target_rule')),
];

const scanIntervalRules = [
  (value: unknown) => integerValidator(value, t('warm_channel_integer_rule')),
  (value: unknown) =>
    betweenValidator(value, 5, 3600, t('warm_channel_scan_interval_rule')),
];

const reservationRules = [
  (value: unknown) => integerValidator(value, t('warm_channel_integer_rule')),
  (value: unknown) =>
    betweenValidator(value, 10, 3600, t('warm_channel_reservation_ttl_rule')),
];

const staleRules = [
  (value: unknown) => integerValidator(value, t('warm_channel_integer_rule')),
  (value: unknown) =>
    betweenValidator(value, 30, 3600, t('warm_channel_warming_stale_rule')),
];

const syncForm = () => {
  if (!props.settings) return;

  form.warmup_enabled = props.settings.warmup_enabled;
  form.target_ready_baileys = props.settings.target_ready_baileys;
  form.target_ready_wwebjs = props.settings.target_ready_wwebjs;
  form.target_ready_whatsmeow = props.settings.target_ready_whatsmeow;
  form.scan_interval_seconds = props.settings.scan_interval_seconds;
  form.reservation_ttl_seconds = props.settings.reservation_ttl_seconds;
  form.warming_stale_after_seconds = props.settings.warming_stale_after_seconds;
};

const toNumber = (value: number): number => Number(value);

const handleSubmit = async () => {
  const validateForm = await refForm.value?.validate();
  if (!validateForm?.valid) return;

  const result = await warmChannelsStore.updateWarmChannelSettings({
    warmup_enabled: form.warmup_enabled,
    target_ready_baileys: toNumber(form.target_ready_baileys),
    target_ready_wwebjs: toNumber(form.target_ready_wwebjs),
    target_ready_whatsmeow: toNumber(form.target_ready_whatsmeow),
    scan_interval_seconds: toNumber(form.scan_interval_seconds),
    reservation_ttl_seconds: toNumber(form.reservation_ttl_seconds),
    warming_stale_after_seconds: toNumber(form.warming_stale_after_seconds),
  });

  if (!result) return;

  emit('saved');
  isVisible.value = false;
};

watch(
  () => props.settings,
  () => syncForm(),
  { immediate: true }
);

watch(isVisible, (value) => {
  if (value) {
    syncForm();
    refForm.value?.resetValidation();
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="760" persistent>
    <DialogCloseBtn :disabled="loading" @click="isVisible = false" />

    <VCard>
      <VCardItem class="pb-2">
        <VCardTitle>{{ $t('warm_channel_settings') }}</VCardTitle>
        <VCardSubtitle>
          {{ $t('warm_channel_settings_subtitle') }}
        </VCardSubtitle>
      </VCardItem>

      <VDivider />

      <VForm ref="refForm" @submit.prevent="handleSubmit">
        <VCardText>
          <div class="settings-form">
            <div class="settings-toggle">
              <div>
                <div class="text-body-1 font-weight-medium">
                  {{ $t('warm_channel_auto_warmup') }}
                </div>
                <div class="text-caption text-medium-emphasis">
                  {{ $t('warm_channel_auto_warmup_hint') }}
                </div>
              </div>
              <VSwitch
                v-model="form.warmup_enabled"
                color="success"
                inset
                hide-details
              />
            </div>

            <div class="settings-section">
              <div class="settings-section__title">
                <VIcon icon="tabler-stack-2" size="20" />
                <span>{{ $t('warm_channel_targets_by_type') }}</span>
              </div>
              <div class="settings-grid settings-grid--three">
                <AppTextField
                  v-model.number="form.target_ready_baileys"
                  type="number"
                  min="0"
                  max="100"
                  :label="$t('unofficial_socket')"
                  :rules="targetRules"
                />
                <AppTextField
                  v-model.number="form.target_ready_wwebjs"
                  type="number"
                  min="0"
                  max="100"
                  :label="$t('unofficial_browser')"
                  :rules="targetRules"
                />
                <AppTextField
                  v-model.number="form.target_ready_whatsmeow"
                  type="number"
                  min="0"
                  max="100"
                  :label="$t('unofficial_whatsmeow')"
                  :rules="targetRules"
                />
              </div>
            </div>

            <div class="settings-section">
              <div class="settings-section__title">
                <VIcon icon="tabler-clock-cog" size="20" />
                <span>{{ $t('warm_channel_operational_settings') }}</span>
              </div>
              <div class="settings-grid">
                <AppTextField
                  v-model.number="form.scan_interval_seconds"
                  type="number"
                  min="5"
                  max="3600"
                  :label="$t('warm_channel_scan_interval_seconds')"
                  :rules="scanIntervalRules"
                />
                <AppTextField
                  v-model.number="form.reservation_ttl_seconds"
                  type="number"
                  min="10"
                  max="3600"
                  :label="$t('warm_channel_reservation_ttl_seconds')"
                  :rules="reservationRules"
                />
                <AppTextField
                  v-model.number="form.warming_stale_after_seconds"
                  type="number"
                  min="30"
                  max="3600"
                  :label="$t('warm_channel_warming_stale_after_seconds')"
                  :rules="staleRules"
                />
              </div>
            </div>
          </div>
        </VCardText>

        <VDivider />

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn
            color="secondary"
            variant="tonal"
            :disabled="loading"
            @click="isVisible = false"
          >
            {{ $t('cancel') }}
          </VBtn>
          <VBtn color="primary" variant="flat" type="submit" :loading="loading">
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VForm>
    </VCard>
  </VDialog>
</template>

<style scoped>
.settings-form {
  display: grid;
  gap: 1.25rem;
}

.settings-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.875rem 1rem;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
}

.settings-section {
  display: grid;
  gap: 0.875rem;
}

.settings-section__title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 600;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(160px, 1fr));
  gap: 1rem;
}

.settings-grid--three {
  grid-template-columns: repeat(3, minmax(140px, 1fr));
}

@media (max-width: 720px) {
  .settings-toggle {
    align-items: flex-start;
    flex-direction: column;
  }

  .settings-grid,
  .settings-grid--three {
    grid-template-columns: 1fr;
  }
}
</style>
