INSERT INTO "plan" ("plan_id", "name", "price", "price_old", "description", "annual_discount", "icon") VALUES ('019ae6ac-e874-719b-8ee7-1f9d8bc667da', 'Bronze', 100.00, 150.00, 'Ideal para pequenas empresas que estão começando no atendimento digital. Inclui recursos essenciais de mensageria, chatbot básico e suporte técnico completo. Perfeito para quem busca uma solução acessível e eficiente para melhorar a comunicação com clientes via WhatsApp. Comece sua transformação digital hoje mesmo!', 10, 'tabler-coin');

INSERT INTO "plan" ("plan_id", "name", "price", "price_old", "description", "annual_discount", "icon") VALUES ('019ae6ad-4705-7119-a020-7c26cfc066c4', 'Prata', 200.00, 300.00, 'Solução completa para empresas em crescimento que precisam de mais recursos e capacidade. Inclui funcionalidades avançadas de chatbot, gestão de conversas otimizada e suporte técnico prioritário. Ideal para empresas que buscam escalar seu atendimento e oferecer uma experiência superior aos clientes.', 10, 'tabler-medal');

INSERT INTO "plan" ("plan_id", "name", "price", "price_old", "description", "annual_discount", "icon") VALUES ('019ae6ad-6aea-71ef-9a3a-40e3a7ffa2e3', 'Ouro', 300.00, 500.00, 'Plano premium com recursos avançados para empresas que exigem excelência em atendimento. Inclui automações inteligentes, analytics detalhados, integrações avançadas e suporte técnico dedicado. A escolha perfeita para empresas que valorizam qualidade e buscam diferenciação competitiva no mercado.', 10, 'tabler-crown');

INSERT INTO "plan" ("plan_id", "name", "price", "price_old", "description", "annual_discount", "icon") VALUES ('019a930d-c6f4-75ad-88ff-847edc5f724c', 'Diamante', 500.00, 800.00, 'Solução enterprise completa para grandes organizações que precisam do máximo em performance e recursos. Inclui todas as funcionalidades premium, capacidade ilimitada, automações personalizadas, suporte técnico 24/7 e gerente de conta dedicado. A escolha definitiva para empresas que não abrem mão da excelência.', 10, 'tabler-diamond');

INSERT INTO "plan" ("plan_id", "name", "price", "price_old", "description", "annual_discount", "icon") VALUES ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e5f', 'Teste', 0.00, 0.00, 'Plano gratuito ideal para usuários que desejam conhecer e testar todas as funcionalidades do sistema antes de se comprometerem com um plano pago. Inclui acesso completo a todas as ferramentas e recursos disponíveis, permitindo uma avaliação completa da plataforma. Perfeito para explorar as capacidades de mensageria, chatbot, automações e demais funcionalidades sem custos.', 0, 'tabler-test-pipe');

-- Teste: 1x Canais, 1x Cargos, 1x Usuários
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd1', '019a930d-c6f4-75ad-88ff-789aa55255f8', '019a930d-c6f4-75ad-88ff-9a1b2c3d4e5f', 1);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd2', '019a930d-c6f4-75ad-88ff-7f14ca11114c', '019a930d-c6f4-75ad-88ff-9a1b2c3d4e5f', 1);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd3', '019a930d-c6f4-75ad-88ff-809fbe7cf6d8', '019a930d-c6f4-75ad-88ff-9a1b2c3d4e5f', 1);

-- Bronze: 1x Canais, 1x Cargos, 1x Usuários
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd4', '019a930d-c6f4-75ad-88ff-789aa55255f8', '019ae6ac-e874-719b-8ee7-1f9d8bc667da', 1);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd5', '019a930d-c6f4-75ad-88ff-7f14ca11114c', '019ae6ac-e874-719b-8ee7-1f9d8bc667da', 1);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd6', '019a930d-c6f4-75ad-88ff-809fbe7cf6d8', '019ae6ac-e874-719b-8ee7-1f9d8bc667da', 1);

-- Prata: 1x Canais, 4x Cargos, 4x Usuários
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd7', '019a930d-c6f4-75ad-88ff-789aa55255f8', '019ae6ad-4705-7119-a020-7c26cfc066c4', 1);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd8', '019a930d-c6f4-75ad-88ff-7f14ca11114c', '019ae6ad-4705-7119-a020-7c26cfc066c4', 4);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dd9', '019a930d-c6f4-75ad-88ff-809fbe7cf6d8', '019ae6ad-4705-7119-a020-7c26cfc066c4', 4);

-- Ouro: 1x Canais, 8x Cargos, 8x Usuários
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dda', '019a930d-c6f4-75ad-88ff-789aa55255f8', '019ae6ad-6aea-71ef-9a3a-40e3a7ffa2e3', 1);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17ddb', '019a930d-c6f4-75ad-88ff-7f14ca11114c', '019ae6ad-6aea-71ef-9a3a-40e3a7ffa2e3', 8);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17ddc', '019a930d-c6f4-75ad-88ff-809fbe7cf6d8', '019ae6ad-6aea-71ef-9a3a-40e3a7ffa2e3', 8);

-- Diamante: 2x Canais, 20x Cargos, 20x Usuários
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17ddd', '019a930d-c6f4-75ad-88ff-789aa55255f8', '019a930d-c6f4-75ad-88ff-847edc5f724c', 2);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17dde', '019a930d-c6f4-75ad-88ff-7f14ca11114c', '019a930d-c6f4-75ad-88ff-847edc5f724c', 20);
INSERT INTO "plan_items" ("plan_item_id", "plan_product_id", "plan_id", "quantity") VALUES ('019a930d-c6f4-75ad-88ff-8918f7b17ddf', '019a930d-c6f4-75ad-88ff-809fbe7cf6d8', '019a930d-c6f4-75ad-88ff-847edc5f724c', 20);