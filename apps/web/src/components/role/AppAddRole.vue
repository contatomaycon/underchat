<script lang="ts" setup>
import { useRolesStore } from '@/@webcore/stores/role';
import { CreateRoleRequest } from '@core/schema/role/createRole/request.schema';
import { VForm } from 'vuetify/components/VForm';

const roleStore = useRolesStore();
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

const refFormAddRole = ref<VForm>();

const addRole = async () => {
  const validateForm = await refFormAddRole?.value?.validate();
  if (!validateForm?.valid) return;

  if (!name.value) {
    return;
  }

  const payload: CreateRoleRequest = {
    name: name.value,
  };

  const result = await roleStore.addRoles(payload);

  if (result) {
    isVisible.value = false;

    await roleStore.listRoles();
  }
};

const resetForm = () => {
  name.value = null;
  refFormAddRole.value?.resetValidation();
};

watch(isVisible, (visible) => {
  if (visible) resetForm();
});

onMounted(resetForm);
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

    <VForm ref="refFormAddRole" @submit.prevent>
      <VCard :title="$t('add_role')">
        <VCardText>
          <VRow>
            <VCol cols="12" sm="12" md="12">
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
          <VBtn @click="addRole"> {{ $t('add') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
