<script lang="ts" setup>
import { useRolesStore } from '@/@webcore/stores/role';
import { EditRoleParamsRequest } from '@core/schema/role/editRole/request.schema';
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

const refFormEditRole = ref<VForm>();

const updateServer = async () => {
  const validateForm = await refFormEditRole?.value?.validate();
  if (!validateForm?.valid) return;

  if (!roleId.value || !name.value) {
    return;
  }

  const payload: EditRoleParamsRequest = {
    name: name.value,
    permission_role_id: roleId.value,
  };

  const result = await roleStore.updateRole(payload);

  if (result) {
    isVisible.value = false;

    await roleStore.listRoles();
  }
};

onMounted(async () => {
  if (!roleId.value) return;

  const nameRole = await roleStore.getRoleById(roleId.value);
  if (nameRole) {
    name.value = nameRole.name;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <template v-if="roleStore.loading">
      <VOverlay
        :model-value="roleStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormEditRole" @submit.prevent>
      <VCard :title="$t('edit_role')">
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
