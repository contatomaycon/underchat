<script lang="ts" setup>
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { EditWorkerRequest } from '@core/schema/worker/editWorker/request.schema';
import { VForm } from 'vuetify/components/VForm';

const channelStore = useChannelsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  channelId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const channelId = toRef(props, 'channelId');
const name = ref<string | null>(null);
const type = ref<EWorkerType | null>(null);

const itemsType = ref([
  { value: EWorkerType.baileys, title: t('unofficial_socket') },
  { value: EWorkerType.wwebjs, title: t('unofficial_browser') },
]);

const refFormEditChannel = ref<VForm>();
const isInitializingModal = ref(false);

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
      <VCard :title="$t('edit_channel')" class="position-relative">
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
                :clearable="true"
                item-value="value"
                item-title="title"
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
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateServer"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
