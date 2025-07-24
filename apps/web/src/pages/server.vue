<script setup lang="ts">
import { EGeneralPermissions } from '@core/common/enums/EPermissions/general';
import { EServerPermissions } from '@core/common/enums/EPermissions/server';

definePage({
  meta: {
    permissions: [
      EGeneralPermissions.full_access,
      EServerPermissions.server_create,
      EServerPermissions.server_view,
      EServerPermissions.server_edit,
      EServerPermissions.server_delete,
    ],
  },
});
</script>

<template>
  <div>
    <VCard title="Create Awesome 🙌">
      <VCardText>This is your second page.</VCardText>
      <VCardText>
        Chocolate sesame snaps pie carrot cake pastry pie lollipop muffin.
        Carrot cake dragée chupa chups jujubes. Macaroon liquorice cookie wafer
        tart marzipan bonbon. Gingerbread jelly-o dragée chocolate.
      </VCardText>
    </VCard>
  </div>
</template>
