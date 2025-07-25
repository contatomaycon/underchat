<script lang="ts" setup>
import { useServerStore } from '@/@webcore/stores/server';
import { EColor } from '@core/common/enums/EColor';
import { EditServerRequest } from '@core/schema/server/editServer/request.schema';

const { t } = useI18n();

const serverStore = useServerStore();

const props = defineProps<{
  modelValue: boolean;
  serverId: number | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', visible: boolean): void;
}>();

const isVisible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
});

const serverId = toRef(props, 'serverId');

const name = ref<string | null>(null);
const ip = ref<string | null>(null);
const port = ref<number | null>(null);
const username = ref<string | null>(null);
const password = ref<string | null>(null);

const updateServer = async () => {
  if (!serverId.value) {
    serverStore.showSnackbar(t('server_id_required'), EColor.error);

    return;
  }

  if (!name.value) {
    serverStore.showSnackbar(t('name_required'), EColor.error);

    return;
  }

  if (!ip.value) {
    serverStore.showSnackbar(t('ip_required'), EColor.error);

    return;
  }

  if (!port.value) {
    serverStore.showSnackbar(t('port_required'), EColor.error);

    return;
  }

  const payload: EditServerRequest = {
    name: name.value,
    ssh_ip: ip.value,
    ssh_port: port.value,
    ssh_username: username.value,
    ssh_password: password.value,
  };

  const result = await serverStore.updateServer(serverId.value, payload);

  if (result) {
    isVisible.value = false;

    await serverStore.listServers();
  }
};

watch(serverId, async (id) => {
  if (!id) return;

  const server = await serverStore.getServerById(id);
  if (server) {
    name.value = server.name;
    ip.value = server.ssh.ssh_ip;
    port.value = server.ssh.ssh_port;
    username.value = null;
    password.value = null;
  }
});
</script>

<template>
  <VDialog v-model="isVisible" max-width="600">
    <DialogCloseBtn @click="isVisible = false" />

    <VCard :title="$t('edit_server')">
      <VCardText>
        <VRow>
          <VCol cols="12">
            <AppTextField
              v-model="name"
              :label="$t('name') + ':'"
              :placeholder="$t('name_server')"
            />
          </VCol>
          <VCol cols="12" sm="6" md="6">
            <AppTextField
              v-model="ip"
              :label="$t('ip') + ':'"
              :placeholder="$t('ip')"
            />
          </VCol>
          <VCol cols="12" sm="6" md="6">
            <AppTextField
              v-model="port"
              :label="$t('port') + ':'"
              :placeholder="$t('port')"
            />
          </VCol>
          <VCol cols="12" sm="6" md="6">
            <AppTextField
              v-model="username"
              :label="$t('username') + ':'"
              :placeholder="$t('username')"
            />
          </VCol>
          <VCol cols="12" sm="6" md="6">
            <AppTextField
              v-model="password"
              :label="$t('password') + ':'"
              :placeholder="$t('password')"
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
  </VDialog>
</template>
