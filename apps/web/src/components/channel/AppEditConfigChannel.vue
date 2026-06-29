<script lang="ts" setup>
import { computed, nextTick, ref, toRef, watch } from 'vue';
import { useSettingsStore } from '@/@webcore/stores/settings';
import { EWorkerType } from '@core/common/enums/EWorkerType';
import { ListChannelsResponse } from '@core/schema/config/listChannels/response.schema';
import { UpdateChannelRequest } from '@core/schema/config/updateChannel/request.schema';
import { VForm } from 'vuetify/components/VForm';
import AppChannelTypeCards from './AppChannelTypeCards.vue';

const settingsStore = useSettingsStore();

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
const initialType = ref<EWorkerType | null>(null);
const serverId = ref<string | null>(null);
const serverItems = ref<Array<{ value: string; title: string }>>([]);
const refFormEditChannel = ref<VForm>();
const isInitializingModal = ref(false);
const isSaving = ref(false);
const { t } = useI18n();

const isOfficialChannel = computed(
  () => initialType.value === EWorkerType.whatsapp
);

const disabledTypes = computed(() =>
  isOfficialChannel.value
    ? [EWorkerType.baileys, EWorkerType.wwebjs, EWorkerType.whatsmeow]
    : [EWorkerType.whatsapp]
);

const isSubmitDisabled = computed(() => {
  if (!type.value || !name.value?.trim()) {
    return true;
  }

  return !isOfficialChannel.value && !serverId.value;
});

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
    initialType.value = type.value;
    serverId.value = channel.value.server?.id ?? null;

    await loadServerOptions();
  } finally {
    isInitializingModal.value = false;
  }
};

const updateChannel = async () => {
  const validateForm = await refFormEditChannel.value?.validate();
  if (!validateForm?.valid || isSubmitDisabled.value) return;

  if (!channel.value?.id || !name.value) {
    return;
  }

  const payload: UpdateChannelRequest = {
    channel_id: channel.value.id,
    name: name.value,
    worker_type: type.value ?? undefined,
  };

  if (!isOfficialChannel.value && serverId.value) {
    payload.server_id = serverId.value;
  }

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
  <VDialog v-model="isVisible" max-width="860">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditChannel" @submit.prevent="updateChannel">
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

            <VCol v-if="type && !isOfficialChannel" cols="12" md="6">
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
          <VBtn
            type="submit"
            :loading="isSaving"
            :disabled="isSubmitDisabled"
          >
            {{ $t('save') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
