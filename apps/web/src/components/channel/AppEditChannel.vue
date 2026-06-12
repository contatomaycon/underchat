<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { VForm } from 'vuetify/components/VForm';
import AppChannelConnectionTypeInfo from './AppChannelConnectionTypeInfo.vue';
import { IWorkerLifecycleAck } from '@core/common/interfaces/IWorkerLifecycleAck';

const channelStore = useChannelsStore();
const { t } = useI18n();

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

const itemsType = ref([
  { value: EWorkerType.baileys, title: 'Opção 1 (Socket)' },
  { value: EWorkerType.wwebjs, title: 'Opção 2 (Navegador)' },
  { value: EWorkerType.whatsmeow, title: 'Opção 3 (Socket)' },
]);

const refFormEditChannel = ref<VForm>();
const isInitializingModal = ref(false);

const isLifecycleAck = (value: unknown): value is IWorkerLifecycleAck =>
  typeof value === 'object' &&
  value !== null &&
  (value as { queued?: unknown }).queued === true;

const updateServer = async () => {
  const validateForm = await refFormEditChannel?.value?.validate();
  if (!validateForm?.valid) return;

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
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditChannel" @submit.prevent>
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
            <VCol cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('type') }}:</VLabel>
              <AppSelectSearch
                v-model="type"
                :items="itemsType"
                :placeholder="$t('type')"
                :clearable="false"
                item-value="value"
                item-title="title"
                data-testid="edit-channel-type-select"
                option-test-id-prefix="edit-channel-type-option"
              />
            </VCol>

            <VCol cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12">
              <AppChannelConnectionTypeInfo />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn data-testid="edit-channel-save" @click="updateServer">
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
