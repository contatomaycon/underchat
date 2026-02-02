<script lang="ts" setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSelectSearch from '@/components/AppSelectSearch.vue';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { ListAiAgentHumanTransferSectorsResponse } from '@core/schema/aiAgent/listAiAgentHumanTransferSectors/response.schema';
import { ListAiAgentHumanTransferSectorUsersResponse } from '@core/schema/aiAgent/listAiAgentHumanTransferSectorUsers/response.schema';

const aiAgentStore = useAiAgentStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  aiAgentId: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const aiAgentId = computed(() => props.aiAgentId);
const enableHumanTransfer = ref(false);
const sectorIds = ref<string[]>([]);
const userIds = ref<string[]>([]);
const sectors = ref<ListAiAgentHumanTransferSectorsResponse>([]);
const usersBySector = ref<ListAiAgentHumanTransferSectorUsersResponse>([]);
const isLoading = ref(false);
const isSaving = ref(false);
const isInitialLoad = ref(false);
const isLoadingUsers = ref(false);

const sectorOptions = computed(() =>
  sectors.value.map((s) => ({ value: s.id, title: s.name }))
);

const userOptions = computed(() => {
  const seen = new Set<string>();
  const list: { value: string; title: string }[] = [];
  for (const u of usersBySector.value) {
    if (u.id && !seen.has(u.id)) {
      seen.add(u.id);
      const name =
        [u.name, u.last_name].filter(Boolean).join(' ').trim() ||
        u.nickname ||
        u.id;
      list.push({ value: u.id, title: name });
    }
  }
  return list;
});

const enableHumanTransferOptions = computed(() => [
  { value: true, title: t('enable_human_transfer_yes') },
  { value: false, title: t('enable_human_transfer_no') },
]);

const loadData = async () => {
  if (!aiAgentId.value) return;

  isLoading.value = true;
  isInitialLoad.value = true;
  try {
    const [config, sectorList] = await Promise.all([
      aiAgentStore.viewAiAgentHumanTransfer(aiAgentId.value),
      aiAgentStore.listHumanTransferSectors(),
    ]);

    sectors.value = sectorList ?? [];

    if (config) {
      enableHumanTransfer.value = config.enable_human_transfer;
      sectorIds.value = [...config.sector_ids];
      userIds.value = [...config.user_ids];
    } else {
      enableHumanTransfer.value = false;
      sectorIds.value = [];
      userIds.value = [];
    }

    await loadUsersForSectors(sectorIds.value);
  } finally {
    isLoading.value = false;
    isInitialLoad.value = false;
  }
};

const loadUsersForSectors = async (ids: string[]) => {
  if (ids.length === 0) {
    usersBySector.value = [];
    return;
  }

  isLoadingUsers.value = true;
  try {
    const all = await aiAgentStore.listHumanTransferSectorUsersBySectorIds(ids);
    usersBySector.value = all ?? [];
    userIds.value = userIds.value.filter((id) =>
      (all ?? []).some((u) => u.id === id)
    );
  } finally {
    isLoadingUsers.value = false;
  }
};

const handleSectorsChange = () => {
  loadUsersForSectors(sectorIds.value);
};

const handleSave = async () => {
  if (!aiAgentId.value) return;

  isSaving.value = true;
  try {
    const success = await aiAgentStore.upsertAiAgentHumanTransfer(
      aiAgentId.value,
      {
        enable_human_transfer: enableHumanTransfer.value,
        sector_ids: enableHumanTransfer.value ? sectorIds.value : [],
        user_ids: enableHumanTransfer.value ? userIds.value : [],
      }
    );
    if (success) {
      isVisible.value = false;
    }
  } finally {
    isSaving.value = false;
  }
};

watch(isVisible, async (newVal) => {
  if (newVal && aiAgentId.value) {
    await nextTick();
    await loadData();
  }
});

watch(
  sectorIds,
  (newIds) => {
    if (isInitialLoad.value) return;
    if (newIds.length > 0) {
      handleSectorsChange();
    } else {
      usersBySector.value = [];
      userIds.value = [];
    }
  },
  { deep: true }
);

onMounted(() => {
  if (isVisible.value && aiAgentId.value) {
    loadData();
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="560" persistent>
    <VOverlay
      :model-value="isSaving || isLoading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VCard>
      <VCardTitle class="d-flex align-center justify-space-between pa-4">
        <span>{{ $t('human_transfer') }}</span>
        <VBtn
          icon
          size="small"
          variant="text"
          @click="isVisible = false"
          :disabled="isSaving || isLoading"
        >
          <VIcon icon="tabler-x" />
        </VBtn>
      </VCardTitle>
      <VDivider />
      <VCardText class="pa-4">
        <VRow>
          <VCol cols="12">
            <AppSelectSearch
              v-model="enableHumanTransfer"
              :items="enableHumanTransferOptions"
              :label="$t('enable_human_transfer')"
              item-value="value"
              item-title="title"
              :disabled="isSaving || isLoading"
            />
          </VCol>

          <template v-if="enableHumanTransfer">
            <VCol cols="12">
              <AppSelectSearch
                v-model="sectorIds"
                :items="sectorOptions"
                :label="$t('sector')"
                item-value="value"
                item-title="title"
                :disabled="isSaving || isLoading"
                multiple
                chips
                closable-chips
              />
            </VCol>

            <VCol v-if="sectorIds.length > 0" cols="12">
              <AppSelectSearch
                v-model="userIds"
                :items="userOptions"
                :label="$t('user')"
                item-value="value"
                item-title="title"
                :disabled="isSaving || isLoading || isLoadingUsers"
                :loading="isLoadingUsers"
                multiple
                chips
                closable-chips
                clearable
              />
            </VCol>
          </template>
        </VRow>
      </VCardText>
      <VCardText class="d-flex justify-end flex-wrap gap-3">
        <VBtn
          variant="tonal"
          color="secondary"
          @click="isVisible = false"
          :disabled="isSaving || isLoading"
        >
          {{ $t('cancel') }}
        </VBtn>
        <VBtn color="primary" :loading="isSaving" @click="handleSave">
          {{ $t('save') }}
        </VBtn>
      </VCardText>
    </VCard>
  </VDialog>
</template>
