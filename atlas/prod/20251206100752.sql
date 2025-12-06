-- Insert seed "nfse" table
INSERT INTO "nfse" ("nfse_id", "external_id", "name", "municipal_service_description_field", "municipal_service_code", "retain_iss", "iss_value", "cofins_value", "csll_value", "inss_value", "ir_value", "pis_value", "deductions", "default_product", "created_at", "updated_at") VALUES 
  ('019a930d-c6f4-75ad-88ff-9a1b2c3d4e6f', 7623, 'Assessoria e consultoria em informática.', '01.06.01 - Assessoria e consultoria em informática.', '01.06.01', false, 2.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.00000, 0.00000, true, NOW(), NOW())
ON CONFLICT ("nfse_id") DO NOTHING;