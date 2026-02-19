<script lang="ts" setup>
import { nextTick } from 'vue';
import { useChannelsStore } from '@/@webcore/stores/channels';
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { CreateWorkerRequest } from '@core/schema/worker/createWorker/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { can } from '@layouts/plugins/casl';

const channelStore = useChannelsStore();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const canChooseServer = computed(() =>
  can([EGeneralPermissions.full_access, EGeneralPermissions.full_access_group])
);

const name = ref<string | null>(null);
const serverId = ref<string | null>(null);

const serverItems = ref<Array<{ value: string; title: string }>>([]);
const serversLoading = ref(false);

const refFormAddChannel = ref<VForm>();
const isAdding = ref(false);

const loadWorkerServers = async () => {
  if (!canChooseServer.value) {
    return;
  }

  serversLoading.value = true;
  try {
    const result = await channelStore.listWorkerServers();

    if (result) {
      serverItems.value = result.map((s) => ({
        value: s.server_id,
        title: s.name,
      }));
    }
  } finally {
    serversLoading.value = false;
  }
};

const addChannel = async () => {
  const validateForm = await refFormAddChannel?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value) {
    return;
  }

  const payload: CreateWorkerRequest = {
    name: name.value,
  };

  if (canChooseServer.value && serverId.value) {
    payload.server_id = serverId.value;
  }

  isAdding.value = true;
  try {
    const result = await channelStore.addChannel(payload);

    if (result) {
      isVisible.value = false;

      await channelStore.listChannels();
    }
  } finally {
    isAdding.value = false;
  }
};

const resetForm = () => {
  name.value = null;
  serverId.value = null;
  refFormAddChannel.value?.resetValidation();
};

watch(
  isVisible,
  async (visible) => {
    if (visible) {
      resetForm();
      serverItems.value = [];
      await nextTick();
      if (canChooseServer.value) {
        loadWorkerServers();
      }
    }
  },
  { immediate: true }
);

onMounted(resetForm);
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormAddChannel" @submit.prevent>
      <VCard :title="$t('add_channel')">
        <VCardText>
          <VRow>
            <VCol cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol v-if="canChooseServer" cols="12" sm="6" md="6">
              <VLabel class="text-body-2 mb-1">{{ $t('server') }}:</VLabel>
              <AppSelectSearch
                v-model="serverId"
                :items="serverItems"
                :placeholder="$t('select_server')"
                :loading="serversLoading"
                :clearable="true"
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
          <VBtn :loading="isAdding" @click="addChannel">
            {{ $t('add') }}
          </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
