import { Static, Type } from '@sinclair/typebox';

const nodeDataSchema = Type.Object({
  title: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  messageType: Type.Optional(Type.String()),
  text: Type.Optional(Type.String()),
  attachmentFile: Type.Optional(Type.Any()),
  attachmentUrl: Type.Optional(Type.String()),
  attachmentMimetype: Type.Optional(Type.String()),
  attachmentDuration: Type.Optional(Type.Number()),
  attachmentWidth: Type.Optional(Type.Number()),
  attachmentHeight: Type.Optional(Type.Number()),
  continueType: Type.Optional(Type.String()),
  dataType: Type.Optional(Type.String()),
  firstName: Type.Optional(Type.String()),
  lastName: Type.Optional(Type.String()),
  email: Type.Optional(Type.String()),
  cpf: Type.Optional(Type.String()),
  cnpj: Type.Optional(Type.String()),
  redirectType: Type.Optional(Type.String()),
  selectedChannel: Type.Optional(Type.String()),
  selectedUser: Type.Optional(Type.String()),
  selectedSector: Type.Optional(Type.String()),
  selectedSectorUser: Type.Optional(Type.String()),
  tagType: Type.Optional(Type.String()),
  selectedTag: Type.Optional(Type.Array(Type.String())),
  annotation: Type.Optional(Type.String()),
  selectedAiAgent: Type.Optional(Type.String()),
  defaultQuestion: Type.Optional(Type.String()),
  continueMessage: Type.Optional(Type.String()),
  actionAfterInteractions: Type.Optional(Type.Boolean()),
  interactionsQuantity: Type.Optional(Type.Number()),
  distributionType: Type.Optional(Type.String()),
  distributionHasSector: Type.Optional(Type.Boolean()),
  distributionSelectedSector: Type.Optional(Type.String()),
  selectedRandomMessage: Type.Optional(Type.String()),
  conditions: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        conditionType: Type.Optional(Type.String()),
        conditionTerm: Type.Optional(Type.String()),
      })
    )
  ),
  options: Type.Optional(
    Type.Array(
      Type.Object({
        id: Type.String(),
        text: Type.String(),
        required: Type.Optional(Type.Boolean()),
      })
    )
  ),
});

const nodeSchema = Type.Object({
  id: Type.String(),
  type: Type.String(),
  position: Type.Object({
    x: Type.Number(),
    y: Type.Number(),
  }),
  data: nodeDataSchema,
  label: Type.Optional(Type.String()),
  draggable: Type.Optional(Type.Boolean()),
});

const edgeSchema = Type.Object({
  id: Type.String(),
  source: Type.String(),
  target: Type.String(),
  sourceHandle: Type.Optional(Type.String()),
  targetHandle: Type.Optional(Type.String()),
  markerEnd: Type.Optional(Type.Any()),
  style: Type.Optional(Type.Any()),
});

const requestDataSchema = Type.Object({
  chatbot_id: Type.String(),
  nodes: Type.Array(nodeSchema),
  edges: Type.Array(edgeSchema),
});

export const saveChatbotFlowRequestSchema = Type.Object({
  request: Type.Union([
    requestDataSchema,
    Type.String(),
    Type.Object({
      value: Type.String(),
    }),
  ]),
});

export type SaveChatbotFlowRequest = Static<
  typeof saveChatbotFlowRequestSchema
>;

export type SaveChatbotFlowRequestData = Static<typeof requestDataSchema>;
