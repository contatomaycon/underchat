<script lang="ts" setup>
import { ref, watch, onMounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUsersStore } from '@/@webcore/stores/user';
import { usePermissionStore } from '@/@webcore/stores/permission';
import { AssignUserRoleRequest } from '@core/schema/user/assignUserRole/request.schema';
import { VForm } from 'vuetify/components/VForm';
import { requiredValidator } from '@/@webcore/utils/validators';

const { t } = useI18n();
const userStore = useUsersStore();
const permissionStore = usePermissionStore();

const props = defineProps<{
  modelValue: boolean;
  userId: string | null;
}>();

const emit = defineEmits<(e: 'update:modelValue', visible: boolean) => void>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const permissionRoleId = ref<string | null>(null);
const refFormAssignRole = ref<VForm>();

const roleOptions = ref<{ id: string; name: string }[]>([]);

const loadRolesByAccount = async (accountId: string) => {
  try {
    const roles = await permissionStore.listPermissionRoleAccount(accountId);
    if (roles) {
      roleOptions.value = roles.map((role) => ({
        id: role.id,
        name: role.name,
      }));
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
    const user = await userStore.viewUserById(props.userId);
    if (!user?.account?.account_id) {
      roleOptions.value = [];
      permissionRoleId.value = null;
      return;
    }

    await loadRolesByAccount(user.account.account_id);

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
  if (!props.userId || !permissionRoleId.value) return;

  const validateForm = await refFormAssignRole.value?.validate();
  if (!validateForm?.valid) return;

  const userData = await userStore.viewUserById(props.userId);
  if (!userData?.account?.account_id) {
    return;
  }

  const payload: AssignUserRoleRequest = {
    permission_role_id: permissionRoleId.value,
    account_id: userData.account.account_id,
  };

  const result = await userStore.assignUserRole(props.userId, payload);

  if (result) {
    isVisible.value = false;
    await userStore.listUsers();
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

    <template v-if="userStore.loading || permissionStore.loading">
      <VOverlay
        :model-value="userStore.loading || permissionStore.loading"
        class="align-center justify-center"
      >
        <VProgressCircular color="primary" indeterminate size="32" />
      </VOverlay>
    </template>

    <VForm ref="refFormAssignRole" @submit.prevent>
      <VCard :title="$t('assign_role')">
        <VCardText>
          <VRow>
            <VCol cols="12">
              <AppAutocomplete
                v-model="permissionRoleId"
                :items="roleOptions"
                item-title="name"
                item-value="id"
                :label="$t('cargos') + ':'"
                :placeholder="$t('select_role')"
                :rules="[
                  requiredValidator(permissionRoleId, $t('role_required')),
                ]"
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

