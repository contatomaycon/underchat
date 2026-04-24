<script lang="ts" setup>
import { useSettingsStore } from '@/@webcore/stores/settings';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { UpdateChannelRequest } from '@core/schema/config/updateChannel/request.schema';
import { VForm } from 'vuetify/components/VForm';

const settingsStore = useSettingsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  channel: ListChannelsResponse | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
  (e: 'updated'): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
});

const channel = toRef(props, 'channel');
const name = ref<string | null>(null);
const type = ref<EWorkerType | null>(null);
const serverId = ref<string | null>(null);
const serverItems = ref<Array<{ value: string; title: string }>>([]);

const itemsType = ref([
  { value: EWorkerType.baileys, title: t('unofficial_socket') },
  { value: EWorkerType.wwebjs, title: t('unofficial_browser') },
  { value: EWorkerType.whatsmeow, title: t('unofficial_whatsmeow') },
]);

const refFormEditChannel = ref<VForm>();
const isInitializingModal = ref(false);
const isSaving = ref(false);

const loadServerOptions = async () => {
  const result = await settingsStore.getChannelServers();
  const items =
    result?.map((server) => ({
      value: server.server_id,
      title: server.name,
    })) ?? [];

  const currentServerId = channel.value?.server?.id;
  if (currentServerId) {
    const alreadyExists = items.some((item) => item.value === currentServerId);

    if (!alreadyExists) {
      items.unshift({
        value: currentServerId,
        title: channel.value?.server?.name ?? t('unknown'),
      });
    }
  }

  serverItems.value = items;
};

const initializeModal = async () => {
  if (!isVisible.value || !channel.value) return;
  if (isInitializingModal.value) return;

  isInitializingModal.value = true;

  try {
    name.value = channel.value.name;
    type.value = (channel.value.type?.id as EWorkerType) ?? null;
    serverId.value = channel.value.server?.id ?? null;

    await loadServerOptions();
  } finally {
    isInitializingModal.value = false;
  }
};

const updateChannel = async () => {
  const validateForm = await refFormEditChannel.value?.validate();
  if (!validateForm?.valid) return;

  if (!channel.value?.id || !name.value || !serverId.value) {
    return;
  }

  const payload: UpdateChannelRequest = {
    channel_id: channel.value.id,
    name: name.value,
    worker_type: type.value ?? undefined,
    server_id: serverId.value,
  };

  isSaving.value = true;
  try {
    const result = await settingsStore.updateChannel(payload);
    if (!result) return;

    isVisible.value = false;
    await nextTick();
    emit('updated');
  } finally {
    isSaving.value = false;
  }
};

watch(
  isVisible,
  async (visible) => {
    if (visible && channel.value) {
      await initializeModal();
      return;
    }

    if (!visible) {
      refFormEditChannel.value?.resetValidation();
    }
  },
  { immediate: true }
);

watch(
  channel,
  async (nextChannel) => {
    if (isVisible.value && nextChannel) {
      await initializeModal();
    }
  },
  { deep: true }
);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditChannel" @submit.prevent>
      <VCard :title="$t('edit_channel')" class="position-relative">
        <VOverlay
          :model-value="isInitializingModal || isSaving"
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

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('server') }}:</VLabel>
              <AppSelectSearch
                v-model="serverId"
                :items="serverItems"
                :placeholder="$t('select_server')"
                :rules="[requiredValidator(serverId, $t('select_server'))]"
                :clearable="false"
                item-value="value"
                item-title="title"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="updateChannel"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
