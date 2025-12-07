<script lang="ts" setup>
import { useRolesStore } from '@/@webcore/stores/role';
import {
  EditRoleParamsRequest,
  UpdateRoleRequest,
} from '@core/schema/role/editRole/request.schema';
import { VForm } from 'vuetify/components/VForm';

const roleStore = useRolesStore();
const { t } = useI18n();

const props = defineProps<{
  modelValue: boolean;
  roleId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const roleId = toRef(props, 'roleId');
const name = ref<string | null>(null);
const description = ref<string | null>(null);

const refFormEditRole = ref<VForm>();
const isInitializingModal = ref(false);

const updateServer = async () => {
  const validateForm = await refFormEditRole?.value?.validate();
  if (!validateForm?.valid) return;

  if (!roleId.value || !name.value) {
    return;
  }

  const payload: EditRoleParamsRequest = {
    permission_role_id: roleId.value,
  };

  const body: UpdateRoleRequest = {
    name: name.value,
    description: description.value,
  };

  const result = await roleStore.updateRole(payload, body);

  if (result) {
    isVisible.value = false;

    await roleStore.listRoles();
  }
};

const initializeModal = async () => {
  if (!isVisible.value || !roleId.value) return;
  if (isInitializingModal.value) return;

  isInitializingModal.value = true;

  try {
    const nameRole = await roleStore.getRoleById(roleId.value);
    if (nameRole) {
      name.value = nameRole.name;
      description.value = nameRole.description ?? null;
    }
  } finally {
    isInitializingModal.value = false;
  }
};

watch(isVisible, async (visible) => {
  if (visible && roleId.value) {
    await initializeModal();
  }
}, { immediate: true });
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VForm ref="refFormEditRole" @submit.prevent>
      <VCard :title="$t('edit_role')" class="position-relative">
        <VOverlay
          :model-value="isInitializingModal || roleStore.loading"
          class="align-center justify-center"
          contained
        >
          <VProgressCircular color="primary" indeterminate size="64" />
        </VOverlay>
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppTextField
                v-model="name"
                :label="$t('name') + ':'"
                :placeholder="$t('name')"
                :rules="[requiredValidator(name, $t('name_required'))]"
              />
            </VCol>
            <VCol cols="12">
              <AppTextarea
                v-model="description"
                :label="$t('description') + ':'"
                :placeholder="$t('description')"
                rows="3"
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
