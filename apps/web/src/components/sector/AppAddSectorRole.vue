<script lang="ts" setup>
import { useSectorsStore } from '@/@webcore/stores/sector';
import { VForm } from 'vuetify/components/VForm';
import { ListRoleAccountResponse } from '@core/schema/sector/listSectorRoleAccount/response.schema';
import { CreateSectorRoleRequest } from '@core/schema/sector/createSectorRole/request.schema';

const sectorStore = useSectorsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  sectorId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const sectorId = toRef(props, 'sectorId');
const nameId = ref<string[]>([]);
const sectorRoleOptions = ref<ListRoleAccountResponse[]>([]);

const refFormEditSector = ref<VForm>();

function uniqById(arr: ListRoleAccountResponse[]) {
  const map = new Map<string, ListRoleAccountResponse>();
  for (const it of arr) map.set(it.id, it);
  return Array.from(map.values());
}

const saveSectorRole = async () => {
  const validateForm = await refFormEditSector?.value?.validate();
  if (!validateForm?.valid) return;

  if (!sectorId.value) {
    return;
  }

  const payload: string = sectorId.value;

  const body: CreateSectorRoleRequest = {
    permission_role_id: nameId.value,
  };

  const result = await sectorStore.addSectorRole(payload, body);

  if (result) {
    isVisible.value = false;

    await sectorStore.listSectors();
  }
};

onMounted(async () => {
  if (!sectorId.value) return;

  const [allRoles, assignedRoles] = await Promise.all([
    sectorStore.listSectorsRoleAccount(),
    sectorStore.listSectorsRoleSectorId(sectorId.value),
  ]);

  const all = Array.isArray(allRoles) ? allRoles : allRoles ? [allRoles] : [];
  const assigned = Array.isArray(assignedRoles)
    ? assignedRoles
    : assignedRoles
      ? [assignedRoles]
      : [];

  sectorRoleOptions.value = uniqById([...all, ...assigned]);

  nameId.value = assigned.map((r) => r.id);
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="sectorStore.loading">
      <VOverlay
        :model-value="sectorStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditSector" @submit.prevent>
      <VCard :title="$t('add_role')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <label
                :for="'sector-role-select'"
                class="d-block text-body-2 font-weight-medium mb-1"
              >
                {{ $t('cargos') }}:
              </label>
              <AppAutocomplete
                :items="sectorRoleOptions"
                item-title="name"
                item-value="id"
                :placeholder="$t('select_role')"
                v-model="nameId"
                chips
                multiple
                closable-chips
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="saveSectorRole"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
