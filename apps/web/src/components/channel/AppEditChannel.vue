<script lang="ts" setup>
import { computed, ref, toRef, watch } from 'vue';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';
import AppChannelTypeCards from './AppChannelTypeCards.vue';

const channelStore = useChannelsStore();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (
    e: 'updated',
    data: {
      worker_id: string;
      worker_type?: EWorkerType;
      account_id?: string;
      lifecycle_operation_id?: string;
      debug_trace_id?: string;
    }
  ): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const channelId = toRef(props, 'channelId');
const name = ref<string | null>(null);
const type = ref<EWorkerType | null>(null);
const initialType = ref<EWorkerType | null>(null);
const refFormEditChannel = ref<VForm>();
const isInitializingModal = ref(false);

const isOfficialChannel = computed(
  () => initialType.value === EWorkerType.whatsapp
);

const disabledTypes = computed(() =>
  isOfficialChannel.value
    ? [EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow]
    : [EWorkerType.whatsapp]
);

const isLifecycleAck = (value: unknown): value is IWorkerLifecycleAck =>
  typeof value === 'object' &&
  value !== null &&
  (value as { queued?: unknown }).queued === true;

const isSubmitDisabled = computed(() => !type.value || !name.value?.trim());

const updateServer = async () => {
  const validateForm = await refFormEditChannel.value?.validate();
  if (!validateForm?.valid || isSubmitDisabled.value) return;

  if (!channelId.value || !name.value) {
    return;
  }

  const payload: EditWorkerRequest = {
    name: name.value,
    worker_id: channelId.value,
    worker_type: type.value ?? undefined,
  };

  const result = await channelStore.updateChannel(payload);

  if (result) {
    isVisible.value = false;
    const lifecycleAck = isLifecycleAck(result) ? result : null;
    if (
      lifecycleAck ||
      (payload.worker_type && payload.worker_type !== initialType.value)
    ) {
      emit('updated', {
        worker_id: payload.worker_id,
        worker_type:
          (lifecycleAck?.worker_type_id as EWorkerType | undefined) ??
          (payload.worker_type as EWorkerType | undefined),
        account_id: lifecycleAck?.account_id,
        lifecycle_operation_id: lifecycleAck?.operation_id,
        debug_trace_id: lifecycleAck?.debug_trace_id,
      });
    }

    await channelStore.listChannels();
  }
};

const initializeModal = async () => {
  if (!isVisible.value || !channelId.value) return;
  if (isInitializingModal.value) return;

  isInitializingModal.value = true;

  try {
    const channel = await channelStore.getWorkerById(channelId.value);
    if (channel) {
      name.value = channel.name;
      type.value = (channel.type?.id as EWorkerType) ?? null;
      initialType.value = type.value;
    }
  } finally {
    isInitializingModal.value = false;
  }
};

watch(
  isVisible,
  async (visible) => {
    if (visible && channelId.value) {
      await initializeModal();
    }
  },
  { immediate: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="860">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditChannel" @submit.prevent="updateServer">
      <VCard
        :title="$t('edit_channel')"
        class="position-relative"
        data-testid="edit-channel-dialog"
      >
        <VOverlay
          :model-value="isInitializingModal || channelStore.loading"
          class="align-center justify-center"
          contained
        >
          <VProgressCircular color="primary" indeterminate size="64" />
        </VOverlay>
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-2">
                {{ $t('channel_select_type_title') }}
              </VLabel>
              <AppChannelTypeCards
                v-model="type"
                :allow-official="isOfficialChannel"
                :lock-official="isOfficialChannel"
                :disabled-types="disabledTypes"
              />
            </VCol>

            <VCol v-if="type" cols="12" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn
            data-testid="edit-channel-save"
            type="submit"
            :disabled="isSubmitDisabled"
          >
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
