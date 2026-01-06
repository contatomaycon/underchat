<script lang="ts" setup>
import { useSectorsStore } from '@/@webcore/stores/sector';
import { CreateSectorRequest } from '@core/schema/sector/createSector/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { ListRoleAccountResponse } from '@core/schema/sector/listSectorRoleAccount/response.schema';

const sectorStore = useSectorsStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const name = ref<string | null>(null);
const permissionRoleId = ref<string[]>([]);
const roleOptions = ref<ListRoleAccountResponse[]>([]);

const DEFAULT_COLOR = '#A89999';
const color = ref<string>(DEFAULT_COLOR);

const refFormAddSector = ref<VForm>();

const loadRoles = async () => {
  try {
    const roles = await sectorStore.listSectorsRoleAccount();
    if (roles) {
      const rolesArray = Array.isArray(roles) ? roles : [roles];
      roleOptions.value = rolesArray;
    } else {
      roleOptions.value = [];
    }
  } catch (error) {
    console.error('Error loading roles:', error);
    roleOptions.value = [];
  }
};

const addSectors = async () => {
  const validateForm = await refFormAddSector?.value?.validate();
  if (!validateForm?.valid) return;

  if (
    !name.value ||
    !color.value ||
    !permissionRoleId.value ||
    permissionRoleId.value.length === 0
  ) {
    return;
  }

  const payload: CreateSectorRequest = {
    name: name.value,
    color: color.value.toUpperCase(),
    permission_role_id: permissionRoleId.value,
  };

  const result = await sectorStore.addSectors(payload);

  if (result) {
    isVisible.value = false;

    await sectorStore.listSectors();
  }
};

const resetForm = () => {
  name.value = null;
  permissionRoleId.value = [];
  color.value = DEFAULT_COLOR;
  refFormAddSector.value?.resetValidation();
};

watch(isVisible, async (visible) => {
  if (visible) {
    resetForm();
    await loadRoles();
  }
});

onMounted(async () => {
  resetForm();
  await loadRoles();
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="sectorStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAddSector" @submit.prevent>
      <VCard :title="$t('add_sector')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('name') }}:</VLabel>
              <AppTextField
                v-model="name"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>

            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('cargos') }}:</VLabel>
              <AppAutocomplete
                v-model="permissionRoleId"
                :items="roleOptions"
                :placeholder="$t('select_role')"
                item-value="id"
                item-title="name"
                chips
                multiple
                closable-chips
                :rules="[
                  requiredValidator(
                    permissionRoleId.length > 0,
                    $t('role_required')
                  ),
                ]"
              />
            </VCol>

            <VCol cols="12">
              <div class="d-flex align-center">
                <div class="d-flex align-center gap-2">
                  <label :for="'color-picker'" class="mb-0 fw-semibold"
                    >{{ $t('cor') }}:</label
                  >
                  <span class="color-value">{{ color.toUpperCase() }}</span>
                </div>
                <div class="flex-grow-1"></div>
                <div class="d-flex align-center gap-2">
                  <input
                    type="color"
                    v-model="color"
                    class="color-input"
                    aria-label="seletor de cor"
                  />
                  <div
                    class="swatch-large"
                    :style="{ backgroundColor: color || '' }"
                    aria-label="preview da cor"
                  ></div>
                </div>
              </div>
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="addSectors"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
