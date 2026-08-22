-- Pairing has crossed the QR-consumption boundary but is not ONLINE yet.
-- This is a manager-authorized operational status: provider-native evidence
-- is correlated to the active connection attempt before worker is updated.
INSERT INTO "worker_status" ("worker_status_id", "status")
VALUES ('019fee6d-09b1-752b-b759-943c3743db7e', 'connecting');
