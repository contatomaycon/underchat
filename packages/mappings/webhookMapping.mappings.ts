export const webhookMappingMappings = () => {
  return {
    mappings: {
      properties: {
        account_id: {
          type: 'keyword',
        },
        mapping: {
          type: 'object',
          dynamic: true,
        },
        created_at: {
          type: 'date',
        },
        updated_at: {
          type: 'date',
        },
      },
    },
  };
};
