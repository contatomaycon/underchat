<script setup lang="ts">
import type { ViewOperatorReplyPendingRedistributionResponse } from '@core/schema/worker/viewOperatorReplyPendingRedistribution/response.schema';

const props = defineProps<{
  modelValue: boolean;
  enabled: boolean;
  timeMinutes: number;
  sectorIds: string[];
  availableSectors: ViewOperatorReplyPendingRedistributionResponse['available_sectors'];
  loading: boolean;
}>();

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void;
  (event: 'update:enabled', value: boolean): void;
  (event: 'update:timeMinutes', value: number): void;
  (event: 'update:sectorIds', value: string[]): void;
  (event: 'save'): void;
}>();

const dialogOpen = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
});

const enabledModel = computed({
  get: () => props.enabled,
  set: (value: boolean) => emit('update:enabled', value),
});

const timeModel = computed({
  get: () => props.timeMinutes,
  set: (value: number | string) => emit('update:timeMinutes', Number(value)),
});

const sectorIdsModel = computed({
  get: () => props.sectorIds,
  set: (value: string[]) => emit('update:sectorIds', value),
});
</script>

<template>
  <VDialog v-model="dialogOpen" max-width="560" persistent>
    <VCard>
      <VCardTitle class="d-flex justify-space-between align-center">
        <span>{{
          $t(
            'channel_general_config_operator_reply_pending_redistribution_title'
          )
        }}</span>
        <div class="d-flex align-center gap-2">
          <VSwitch v-model="enabledModel" color="primary" :disabled="loading" />
          <IconBtn
            :disabled="loading"
            @click="emit('update:modelValue', false)"
          >
            <VIcon icon="tabler-x" />
          </IconBtn>
        </div>
      </VCardTitle>

      <VCardText>
        <p class="text-body-2 text-medium-emphasis mb-4">
          {{
            $t(
              'channel_general_config_operator_reply_pending_redistribution_description'
            )
          }}
        </p>

        <VLabel class="text-body-2 mb-1">
          {{ $t('operator_reply_pending_redistribution_time_label') }}:
        </VLabel>
        <AppTextField
          v-model.number="timeModel"
          type="number"
          min="1"
          :disabled="loading || !enabledModel"
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{ $t('operator_reply_pending_redistribution_time_hint') }}
        </div>

        <VLabel class="text-body-2 mt-4 mb-1">
          {{ $t('operator_reply_pending_redistribution_sectors_label') }}:
        </VLabel>
        <AppSelectSearch
          v-model="sectorIdsModel"
          :items="availableSectors"
          item-title="name"
          item-value="id"
          :placeholder="
            $t('operator_reply_pending_redistribution_sectors_placeholder')
          "
          multiple
          chips
          closable-chips
          clearable
          :disabled="loading || !enabledModel"
        />
        <div class="text-caption text-medium-emphasis mt-2">
          {{ $t('operator_reply_pending_redistribution_sectors_hint') }}
        </div>

        <VAlert class="mt-4" type="info" variant="tonal" density="compact">
          {{ $t('operator_reply_pending_redistribution_action') }}
        </VAlert>
      </VCardText>

      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          :disabled="loading"
          @click="emit('update:modelValue', false)"
        >
          {{ $t('close') }}
        </VBtn>
        <VBtn
          color="primary"
          :loading="loading"
          :disabled="loading"
          @click="emit('save')"
        >
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
