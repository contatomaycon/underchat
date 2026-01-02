<script lang="ts" setup>
import { ref, watch, onMounted, nextTick, computed } from 'vue';
import { useUsersStore } from '@/@webcore/stores/user';
import { AssignUserRoleRequest } from '@core/schema/user/assignUserRole/request.schema';
import {
  EditUserParamsRequest,
  UpdateUserRequest,
} from '@core/schema/user/editUser/request.schema';
import { VForm } from 'vuetify/components/VForm';

const userStore = useUsersStore();

const props = defineProps<{
  modelValue: boolean;
  userId: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [visible: boolean];
  'role-assigned': [];
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const permissionRoleId = ref<string | null>(null);
const refFormAssignRole = ref<VForm>();

const roleOptions = ref<{ id: string; name: string }[]>([]);

const loadRoles = async () => {
  try {
    const roles = await userStore.listUserRoles();
    if (roles) {
      roleOptions.value = roles;
    } else {
      roleOptions.value = [];
    }
  } catch (error) {
    console.error('Error loading roles:', error);
    roleOptions.value = [];
  }
};

const loadUserRole = async () => {
  if (!props.userId) return;

  try {
    await loadRoles();

    await nextTick();
    const currentRole = await userStore.getUserRole(props.userId);
    if (currentRole) {
      const roleExists = roleOptions.value.some(
        (role) => role.id === currentRole
      );
      if (roleExists) {
        permissionRoleId.value = currentRole;
      } else {
        permissionRoleId.value = null;
      }
    } else {
      permissionRoleId.value = null;
    }
  } catch (error) {
    console.error('Error loading user role:', error);
    roleOptions.value = [];
    permissionRoleId.value = null;
  }
};

const assignRole = async () => {
  if (!props.userId) return;

  if (permissionRoleId.value) {
    const payload: AssignUserRoleRequest = {
      permission_role_id: permissionRoleId.value,
    };

    const result = await userStore.assignUserRole(props.userId, payload);

    if (result) {
      isVisible.value = false;
      emit('role-assigned');
    }
  } else {
    const payload: EditUserParamsRequest = {
      user_id: props.userId,
    };

    const body: UpdateUserRequest = {
      permission_role_id: {
        value: null,
      },
    };

    const result = await userStore.updateUser(payload, body);

    if (result) {
      isVisible.value = false;
      emit('role-assigned');
    }
  }
};

const resetForm = () => {
  permissionRoleId.value = null;
  refFormAssignRole.value?.resetValidation();
};

watch(isVisible, async (visible) => {
  if (visible) {
    resetForm();
    await loadUserRole();
  }
});

onMounted(async () => {
  if (isVisible.value) {
    await loadUserRole();
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VOverlay
      :model-value="userStore.loading"
      class="align-center justify-center"
      contained
    >
      <VProgressCircular color="primary" indeterminate size="64" />
    </VOverlay>

    <VForm ref="refFormAssignRole" @submit.prevent>
      <VCard :title="$t('assign_role')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <VLabel class="text-body-2 mb-1">{{ $t('cargo') }}:</VLabel>
              <AppSelectSearch
                v-model="permissionRoleId"
                :items="roleOptions"
                :placeholder="$t('select_role')"
                :clearable="true"
                item-value="id"
                item-title="name"
              />
            </VCol>
          </VRow>
        </VCardText>

        <VCardText class="d-flex justify-end flex-wrap gap-3">
          <VBtn variant="tonal" color="secondary" @click="isVisible = false">
            {{ $t('cancel') }}
          </VBtn>
          <VBtn @click="assignRole"> {{ $t('save') }} </VBtn>
        </VCardText>
      </VCard>
    </VForm>
  </VDialog>
</template>
