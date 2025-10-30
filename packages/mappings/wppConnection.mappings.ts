export const wppConnectionMappings = () => {
  return {
    mappings: {
      properties: {
        worker_id: {
          type: 'keyword',
        },
        status: {
          type: 'keyword',
        },
        code: {
          type: 'keyword',
        },
        message: {
          type: 'text',
        },
        date: {
          type: 'date',
        },
      },
    },
  };
};
