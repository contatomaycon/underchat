<script lang="ts" setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import AppSelectSearch from '@/components/AppSelectSearch.vue';
import { useAiAgentStore } from '@/@webcore/stores/aiAgent';
import { EColor } from '@core/common/enums/EColor';
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
const enableHumanTransferByPrompt = ref(false);
const sectorIds = ref<string[]>([]);
const sectorUserIds = ref<Record<string, string[]>>({});
const sectors = ref<ListAiAgentHumanTransferSectorsResponse>([]);
const usersBySectorId = ref<
  Record<string, ListAiAgentHumanTransferSectorUsersResponse>
>({});
const isLoading = ref(false);
const isSaving = ref(false);
const isInitialLoad = ref(false);
const loadingUsersBySector = ref<Record<string, boolean>>({});

const sectorOptions = computed(() =>
  sectors.value.map((s) => ({ value: s.id, title: s.name }))
);

const enableHumanTransferOptions = computed(() => [
  { value: true, title: t('enable_human_transfer_yes') },
  { value: false, title: t('enable_human_transfer_no') },
]);

const enableHumanTransferByPromptOptions = computed(() => [
  { value: true, title: t('enable_human_transfer_by_prompt_yes') },
  { value: false, title: t('enable_human_transfer_by_prompt_no') },
]);

const sectorRules = computed(() => {
  if (!enableHumanTransfer.value) return [];
  return [
    (v: string[] | unknown) =>
      (Array.isArray(v) && v.length > 0) || t('sector_required'),
  ];
});

function getSectorName(sectorId: string): string {
  return sectors.value.find((s) => s.id === sectorId)?.name ?? sectorId;
}

function getSectorUserIds(sectorId: string): string[] {
  return sectorUserIds.value[sectorId] ?? [];
}

function setSectorUserIds(sectorId: string, value: string[]) {
  sectorUserIds.value = { ...sectorUserIds.value, [sectorId]: value };
}

function userOptionsForSector(
  sectorId: string
): { value: string; title: string }[] {
  const list = usersBySectorId.value[sectorId] ?? [];
  const result: { value: string; title: string }[] = [];
  for (const u of list) {
    if (!u.id) continue;
    const name =
      [u.name, u.last_name].filter(Boolean).join(' ').trim() ||
      u.nickname ||
      u.id;
    result.push({ value: u.id, title: name });
  }
  return result;
}

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

    if (config?.sector_targets?.length) {
      enableHumanTransfer.value = config.enable_human_transfer;
      enableHumanTransferByPrompt.value =
        config.enable_human_transfer_by_prompt ?? false;
      sectorIds.value = config.sector_targets.map((t) => t.sector_id);
      sectorUserIds.value = Object.fromEntries(
        config.sector_targets.map((t) => [t.sector_id, [...(t.user_ids ?? [])]])
      );
    } else {
      enableHumanTransfer.value = config?.enable_human_transfer ?? false;
      enableHumanTransferByPrompt.value =
        config?.enable_human_transfer_by_prompt ?? false;
      sectorIds.value = [];
      sectorUserIds.value = {};
    }

    await loadUsersForSelectedSectors();
  } finally {
    isLoading.value = false;
    isInitialLoad.value = false;
  }
};

const loadUsersForSelectedSectors = async () => {
  const ids = sectorIds.value;
  if (ids.length === 0) {
    usersBySectorId.value = {};
    return;
  }

  for (const id of ids) {
    loadingUsersBySector.value = { ...loadingUsersBySector.value, [id]: true };
  }
  try {
    const results = await Promise.all(
      ids.map(async (id) => {
        const users = await aiAgentStore.listHumanTransferSectorUsers(id);
        return { id, users };
      })
    );
    const next: Record<string, ListAiAgentHumanTransferSectorUsersResponse> =
      {};
    for (const { id, users } of results) {
      next[id] = users ?? [];
    }
    usersBySectorId.value = next;
  } finally {
    for (const id of ids) {
      loadingUsersBySector.value = {
        ...loadingUsersBySector.value,
        [id]: false,
      };
    }
  }
};

const handleSectorsChange = () => {
  const next: Record<string, string[]> = {};
  for (const id of sectorIds.value) {
    next[id] = sectorUserIds.value[id] ?? [];
  }
  sectorUserIds.value = next;
  loadUsersForSelectedSectors();
};

const handleSave = async () => {
  if (!aiAgentId.value) return;

  if (enableHumanTransfer.value && sectorIds.value.length === 0) {
    aiAgentStore.showSnackbar(t('sector_required'), EColor.error);
    return;
  }

  isSaving.value = true;
  try {
    const sector_targets = sectorIds.value.map((sector_id) => ({
      sector_id,
      user_ids: sectorUserIds.value[sector_id] ?? [],
    }));
    const success = await aiAgentStore.upsertAiAgentHumanTransfer(
      aiAgentId.value,
      {
        enable_human_transfer: enableHumanTransfer.value,
        enable_human_transfer_by_prompt: enableHumanTransferByPrompt.value,
        sector_targets: enableHumanTransfer.value ? sector_targets : [],
      }
    );
    if (success) {
      isVisible.value = false;
    }
  } finally {
    isSaving.value = false;
  }
};

function onEnableHumanTransferChange(newVal: boolean) {
  if (newVal) {
    enableHumanTransferByPrompt.value = false;
  }
}

function onEnableHumanTransferByPromptChange(newVal: boolean) {
  if (newVal) {
    enableHumanTransfer.value = false;
  }
}

watch(enableHumanTransfer, onEnableHumanTransferChange);
watch(enableHumanTransferByPrompt, onEnableHumanTransferByPromptChange);

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
      usersBySectorId.value = {};
      sectorUserIds.value = {};
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
                :rules="sectorRules"
                item-value="value"
                item-title="title"
                :disabled="isSaving || isLoading"
                multiple
                chips
                closable-chips
              />
            </VCol>

            <VCol v-if="sectorIds.length > 0" cols="12" class="pt-2">
              <VDivider class="mb-3" />
              <p class="text-body-2 text-medium-emphasis font-weight-bold mb-3">
                {{ $t('human_transfer_users_section') }}
              </p>
            </VCol>

            <VCol v-for="sectorId in sectorIds" :key="sectorId" cols="12">
              <AppSelectSearch
                :model-value="getSectorUserIds(sectorId)"
                @update:model-value="
                  (v) =>
                    setSectorUserIds(
                      sectorId,
                      Array.isArray(v)
                        ? v.filter((x): x is string => typeof x === 'string')
                        : []
                    )
                "
                :items="userOptionsForSector(sectorId)"
                :label="
                  t('select_users_of_sector', {
                    sectorName: getSectorName(sectorId),
                  })
                "
                item-value="value"
                item-title="title"
                :disabled="isSaving || isLoading"
                :loading="loadingUsersBySector[sectorId] === true"
                multiple
                chips
                closable-chips
                clearable
              />
            </VCol>
          </template>

          <VCol cols="12" class="pt-4">
            <VDivider class="mb-4" />
            <AppSelectSearch
              v-model="enableHumanTransferByPrompt"
              :items="enableHumanTransferByPromptOptions"
              :label="$t('enable_human_transfer_by_prompt')"
              item-value="value"
              item-title="title"
              :disabled="isSaving || isLoading"
            />
          </VCol>
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
