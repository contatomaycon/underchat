<script lang="ts" setup>
import { ref, watch, onMounted, nextTick, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { useUsersStore } from '@/@webcore/stores/user';
import { AssignUserRoleRequest } from '@core/schema/user/assignUserRole/request.schema';
import { EditUserParamsRequest, UpdateUserRequest } from '@core/schema/user/editUser/request.schema';
import { VForm } from 'vuetify/components/VForm';

const { t } = useI18n();
const userStore = useUsersStore();

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
const roleSearchQuery = ref('');
const isRoleMenuOpen = ref(false);

const filteredRoles = computed(() => {
  if (!roleSearchQuery.value) {
    return roleOptions.value;
  }
  const query = roleSearchQuery.value.toLowerCase();
  return roleOptions.value.filter((role) =>
    role.name.toLowerCase().includes(query)
  );
});

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
      await userStore.listUsers();
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
      await userStore.listUsers();
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

watch(isRoleMenuOpen, (isOpen) => {
  if (!isOpen) {
    roleSearchQuery.value = '';
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
              <div>
                <VLabel class="mb-1 text-body-2">{{ $t('cargos') }}:</VLabel>
                <VMenu v-model="isRoleMenuOpen">
                  <template #activator="{ props: menuProps }">
                    <VTextField
                      v-bind="menuProps"
                      :model-value="
                        roleOptions.find((r) => r.id === permissionRoleId)
                          ?.name || ''
                      "
                      :placeholder="$t('select_role')"
                      variant="outlined"
                      readonly
                      :clearable="!!permissionRoleId"
                      clear-icon="tabler-x"
                      @click:clear="permissionRoleId = null"
                      :append-inner-icon="
                        permissionRoleId
                          ? undefined
                          : 'tabler-chevron-down'
                      "
                    />
                  </template>
                  <VCard>
                    <VCardText class="pa-2">
                      <AppTextField
                        v-model="roleSearchQuery"
                        :placeholder="$t('search') + '...'"
                        prepend-inner-icon="tabler-search"
                        density="compact"
                        hide-details
                        autofocus
                        @click.stop
                      />
                    </VCardText>
                    <VDivider />
                    <VList max-height="300" style="overflow-y: auto">
                      <VListItem
                        v-for="(item, index) in filteredRoles"
                        :key="index"
                        :value="item.id"
                        @click="
                          () => {
                            permissionRoleId = item.id;
                            isRoleMenuOpen = false;
                          }
                        "
                        :active="permissionRoleId === item.id"
                      >
                        <VListItemTitle>{{ item.name }}</VListItemTitle>
                      </VListItem>
                      <VListItem
                        v-if="
                          filteredRoles.length === 0 &&
                          roleOptions.length === 0 &&
                          !userStore.loading
                        "
                        disabled
                      >
                        <VListItemTitle
                          class="text-center text-body-2 text-medium-emphasis"
                        >
                          {{ $t('no_data_available') }}
                        </VListItemTitle>
                      </VListItem>
                      <VListItem
                        v-else-if="
                          filteredRoles.length === 0 && roleOptions.length > 0
                        "
                        disabled
                      >
                        <VListItemTitle
                          class="text-center text-body-2 text-medium-emphasis"
                        >
                          {{ $t('no_results_found') }}
                        </VListItemTitle>
                      </VListItem>
                    </VList>
                  </VCard>
                </VMenu>
              </div>
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
