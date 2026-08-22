package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

const (
	incomingCallProtocolEventType      = "chat.protocol.updated"
	incomingCallProtocolEventSource    = "chat_service"
	incomingCallIntegrationProductID   = "0eb84ca1-8145-4770-acd4-b6725fe1cf25"
	incomingCallBlockedAccountStatusID = "019a930d-c6f4-75ad-88ff-75403daff4e1"
	incomingCallWebhookMaxTargets      = 25
	incomingCallWebhookMaxPayloadBytes = 1024 * 1024
)

type incomingCallWebhookTarget struct {
	WebhookID     string `json:"webhook_id"`
	ChannelID     string `json:"channel_id"`
	ConfigVersion int    `json:"config_version"`
}

type incomingCallEntitlement struct {
	Allowed  bool
	Revision string
}

func (p *WorkerPostgres) PrepareIncomingCallProtocolEvent(
	ctx context.Context,
	input incomingCallTemplateInput,
	previous *incomingCallChat,
	intended *incomingCallChat,
	protocol string,
) (*preparedIncomingCallProtocolEvent, error) {
	if p == nil || p.DB == nil {
		return nil, errors.New("worker database is unavailable for incoming call outbox")
	}
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if err := p.beginWorkerOperation(ctx, tx, input.WorkerID, input.AccountID); err != nil {
		return nil, err
	}

	entitlement, err := resolveIncomingCallIntegrationEntitlement(ctx, tx, input.AccountID)
	if err != nil {
		return nil, err
	}
	if !entitlement.Allowed {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, nil
	}
	targets, err := captureIncomingCallWebhookTargets(ctx, tx, input.AccountID, input.WorkerID)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return nil, nil
	}

	eventUUID, err := uuid.NewV7()
	if err != nil {
		return nil, err
	}
	eventID := eventUUID.String()
	occurredAt := time.Now().UTC()
	envelope, err := buildIncomingCallProtocolEnvelope(eventID, occurredAt, input, previous, intended, protocol)
	if err != nil {
		return nil, err
	}
	targetPayload, err := json.Marshal(targets)
	if err != nil {
		return nil, err
	}
	idempotencyKey := incomingCallProtocolIdempotencyKey(previous.chatID(), protocol)

	var insertedID, insertedState, insertedRevision string
	var insertedOccurredAt time.Time
	err = tx.QueryRowContext(ctx, `
		INSERT INTO outbound_webhook_event (
			outbound_webhook_event_id, account_id, event_type, state,
			aggregate_type, aggregate_id, routing_channel_ids, payload,
			target_snapshot, idempotency_key, is_test, source,
			integration_entitlement_revision, occurred_at
		) VALUES (
			$1::uuid, $2::uuid, $3, 'preparing', 'chat', $4,
			ARRAY[$5::uuid], $6::jsonb, $7::jsonb, $8, FALSE, $9, $10, $11
		)
		ON CONFLICT (account_id, event_type, idempotency_key) DO NOTHING
		RETURNING outbound_webhook_event_id::text, state,
			integration_entitlement_revision, occurred_at
	`, eventID, input.AccountID, incomingCallProtocolEventType, previous.chatID(),
		input.WorkerID, workerPostgresJSONText(envelope), workerPostgresJSONText(targetPayload), idempotencyKey,
		incomingCallProtocolEventSource, entitlement.Revision, occurredAt,
	).Scan(&insertedID, &insertedState, &insertedRevision, &insertedOccurredAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = tx.QueryRowContext(ctx, `
			SELECT outbound_webhook_event_id::text, state,
				COALESCE(integration_entitlement_revision, ''), occurred_at
			FROM outbound_webhook_event
			WHERE account_id=$1::uuid AND event_type=$2 AND idempotency_key=$3
			FOR UPDATE
		`, input.AccountID, incomingCallProtocolEventType, idempotencyKey).Scan(
			&insertedID, &insertedState, &insertedRevision, &insertedOccurredAt,
		)
		if err != nil {
			return nil, err
		}
		if insertedState == "quarantined" {
			return nil, errors.New("incoming call protocol webhook event is quarantined")
		}
		if insertedState == "cancelled" {
			result, err := tx.ExecContext(ctx, `
				UPDATE outbound_webhook_event
				SET state='preparing', payload=$2::jsonb,
					routing_channel_ids=ARRAY[$3::uuid], target_snapshot=$4::jsonb,
					source=$5, integration_entitlement_revision=$6,
					occurred_at=$7, created_at=clock_timestamp(),
					expires_at=clock_timestamp()+INTERVAL '30 days',
					domain_applied_at=NULL, cancelled_at=NULL, ready_at=NULL
				WHERE outbound_webhook_event_id=$1::uuid AND state='cancelled'
			`, insertedID, workerPostgresJSONText(envelope), input.WorkerID, workerPostgresJSONText(targetPayload),
				incomingCallProtocolEventSource, entitlement.Revision, occurredAt)
			if err != nil {
				return nil, err
			}
			if affected, _ := result.RowsAffected(); affected != 1 {
				return nil, errors.New("incoming call protocol webhook revival lost CAS")
			}
			insertedState = "preparing"
			insertedRevision = entitlement.Revision
			insertedOccurredAt = occurredAt
		}
	} else if err != nil {
		return nil, err
	}
	if insertedState == "cancelled" || insertedState == "quarantined" {
		return nil, fmt.Errorf("incoming call protocol webhook event state=%s", insertedState)
	}
	if insertedRevision != entitlement.Revision {
		return nil, errors.New("incoming call protocol webhook entitlement epoch mismatch")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return &preparedIncomingCallProtocolEvent{
		EventID:                   insertedID,
		OccurredAt:                insertedOccurredAt,
		IntegrationEntitlementRev: insertedRevision,
	}, nil
}

func incomingCallProtocolIdempotencyKey(chatID, protocol string) string {
	idempotencyLogical := "chat-protocol:" + chatID + ":protocol_start:" + protocol
	idempotencyDigest := sha256.Sum256([]byte(idempotencyLogical))
	return hex.EncodeToString(idempotencyDigest[:])
}

func (p *WorkerPostgres) CompleteIncomingCallProtocolEvent(
	ctx context.Context,
	input incomingCallTemplateInput,
	prepared *preparedIncomingCallProtocolEvent,
	previous *incomingCallChat,
	confirmed *incomingCallChat,
	protocol string,
) error {
	if prepared == nil {
		return nil
	}
	if confirmed == nil || !confirmed.hasWebhookMarker(prepared.EventID) {
		return errors.New("incoming call protocol webhook marker is missing")
	}
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := p.beginWorkerOperation(ctx, tx, input.WorkerID, input.AccountID); err != nil {
		return err
	}
	entitlement, err := resolveIncomingCallIntegrationEntitlement(ctx, tx, input.AccountID)
	if err != nil {
		return err
	}

	var state, eventType, aggregateType, aggregateID, capturedRevision string
	var routing pq.StringArray
	var targetPayload, storedPayload []byte
	var occurredAt time.Time
	err = tx.QueryRowContext(ctx, `
		SELECT state, event_type, aggregate_type, aggregate_id,
			routing_channel_ids, target_snapshot, payload,
			COALESCE(integration_entitlement_revision, ''), occurred_at
		FROM outbound_webhook_event
		WHERE outbound_webhook_event_id=$1::uuid AND account_id=$2::uuid
		FOR UPDATE
	`, prepared.EventID, input.AccountID).Scan(
		&state, &eventType, &aggregateType, &aggregateID, &routing,
		&targetPayload, &storedPayload, &capturedRevision, &occurredAt,
	)
	if err != nil {
		return err
	}
	if eventType != incomingCallProtocolEventType || aggregateType != "chat" || aggregateID != confirmed.chatID() {
		return errors.New("incoming call protocol webhook identity mismatch")
	}
	if len(routing) != 1 || !strings.EqualFold(routing[0], input.WorkerID) {
		return errors.New("incoming call protocol webhook channel scope mismatch")
	}
	if state == "cancelled" || state == "quarantined" {
		return fmt.Errorf("incoming call protocol webhook state=%s", state)
	}
	if state == "ready" || state == "discarded" {
		return tx.Commit()
	}
	if !entitlement.Allowed || entitlement.Revision != capturedRevision {
		discarded := discardedIncomingCallWebhookPayload(storedPayload, "integration_entitlement_missing")
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_webhook_event SET state='discarded', payload=$2::jsonb
			WHERE outbound_webhook_event_id=$1::uuid AND state IN ('preparing','ready')
		`, prepared.EventID, workerPostgresJSONText(discarded)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_webhook_delivery
			SET status='suppressed', suppressed_at=clock_timestamp(),
				lease_token=NULL, lease_expires_at=NULL,
				last_error='integration_entitlement_missing', updated_at=clock_timestamp()
			WHERE outbound_webhook_event_id=$1::uuid AND status IN ('pending','retrying')
		`, prepared.EventID); err != nil {
			return err
		}
		return tx.Commit()
	}

	var targets []incomingCallWebhookTarget
	if err := json.Unmarshal(targetPayload, &targets); err != nil || len(targets) == 0 || len(targets) > incomingCallWebhookMaxTargets {
		return errors.New("incoming call protocol webhook target snapshot is invalid")
	}
	validTargets, err := filterExistingIncomingCallWebhookTargets(ctx, tx, input.AccountID, routing, targets)
	if err != nil {
		return err
	}
	if len(validTargets) == 0 {
		discarded := discardedIncomingCallWebhookPayload(storedPayload, "")
		if _, err := tx.ExecContext(ctx, `
			UPDATE outbound_webhook_event SET state='discarded', payload=$2::jsonb
			WHERE outbound_webhook_event_id=$1::uuid AND state='preparing'
		`, prepared.EventID, workerPostgresJSONText(discarded)); err != nil {
			return err
		}
		return tx.Commit()
	}

	envelope, err := buildIncomingCallProtocolEnvelope(prepared.EventID, occurredAt, input, previous, confirmed, protocol)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE outbound_webhook_event
		SET state='ready', payload=$2::jsonb, ready_at=clock_timestamp(), cancelled_at=NULL
		WHERE outbound_webhook_event_id=$1::uuid AND state='preparing'
	`, prepared.EventID, workerPostgresJSONText(envelope))
	if err != nil {
		return err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return errors.New("incoming call protocol webhook completion lost CAS")
	}
	for _, target := range validTargets {
		deliveryUUID, err := uuid.NewV7()
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO outbound_webhook_delivery (
				outbound_webhook_delivery_id, outbound_webhook_id,
				outbound_webhook_event_id, config_version, status
			) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'pending')
			ON CONFLICT DO NOTHING
		`, deliveryUUID.String(), target.WebhookID, prepared.EventID, target.ConfigVersion); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (p *WorkerPostgres) CancelIncomingCallProtocolEvent(ctx context.Context, eventID string) error {
	if p == nil || p.DB == nil || eventID == "" {
		return nil
	}
	p.operationScopeMu.RLock()
	var workerID, accountID string
	if p.operationScope != nil {
		workerID = p.operationScope.workerID
		accountID = p.operationScope.accountID
	}
	p.operationScopeMu.RUnlock()
	tx, err := p.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := p.beginWorkerOperation(ctx, tx, workerID, accountID); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
		UPDATE outbound_webhook_event
		SET state='cancelled', cancelled_at=clock_timestamp()
		WHERE outbound_webhook_event_id=$1::uuid AND state='preparing'
	`, eventID)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func resolveIncomingCallIntegrationEntitlement(ctx context.Context, tx *sql.Tx, accountID string) (incomingCallEntitlement, error) {
	lockKey := accountID + ":" + incomingCallIntegrationProductID
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return incomingCallEntitlement{}, err
	}
	var entitlement incomingCallEntitlement
	err := tx.QueryRowContext(ctx, `
		WITH latest_plan AS (
			SELECT pa.account_id, pa.plan_account_id, pa.plan_id,
				pa.last_payment_date, pa.next_payment_date
			FROM plan_account pa
			WHERE pa.account_id=$1::uuid
			ORDER BY pa.updated_at DESC NULLS LAST,
				pa.created_at DESC NULLS LAST, pa.plan_account_id DESC
			LIMIT 1
		), entitlement_state AS (
			SELECT $1::uuid AS account_id, $2::uuid AS plan_product_id,
				lp.next_payment_date AS valid_until,
				COALESCE(a.account_id IS NOT NULL AND a.deleted_at IS NULL
					AND a.account_status_id<>$3::uuid
					AND lp.plan_account_id IS NOT NULL AND plan_row.deleted_at IS NULL
					AND lp.next_payment_date>NOW(), FALSE) AS plan_is_active,
				EXISTS (
					SELECT 1 FROM plan_items item
					WHERE item.plan_id=lp.plan_id AND item.plan_product_id=$2::uuid
						AND item.quantity>0 AND item.deleted_at IS NULL
				) AS granted_by_plan,
				EXISTS (
					SELECT 1 FROM plan_cross_sell_account account_addon
					JOIN plan_cross_sell addon
					  ON addon.plan_cross_sell_id=account_addon.plan_cross_sell_id
					WHERE account_addon.account_id=$1::uuid
						AND account_addon.deleted_at IS NULL AND addon.deleted_at IS NULL
						AND addon.plan_product_id=$2::uuid AND addon.quantity>0
						AND (account_addon.cancellation_date IS NULL
							OR lp.last_payment_date IS NULL
							OR account_addon.cancellation_date>=lp.last_payment_date)
				) AS granted_by_addon
			FROM (SELECT 1) requested
			LEFT JOIN account a ON a.account_id=$1::uuid
			LEFT JOIN latest_plan lp ON lp.account_id=a.account_id
			LEFT JOIN plan plan_row ON plan_row.plan_id=lp.plan_id
		), resolved AS (
			SELECT account_id, plan_product_id,
				COALESCE(plan_is_active AND (granted_by_plan OR granted_by_addon), FALSE) AS underlying_allowed,
				plan_is_active
			FROM entitlement_state
		), effective AS (
			SELECT resolved.account_id, resolved.plan_product_id,
				resolved.underlying_allowed AND (
					persisted.deny_fence_token IS NULL OR persisted.deny_fence_released_at IS NOT NULL
				) AS allowed
			FROM resolved
			LEFT JOIN account_plan_product_entitlement_revision persisted
			  ON persisted.account_id=resolved.account_id
			 AND persisted.plan_product_id=resolved.plan_product_id
		), revision AS (
			INSERT INTO account_plan_product_entitlement_revision AS entitlement_revision (
				account_id, plan_product_id, revision, allowed, updated_at
			)
			SELECT account_id, plan_product_id, 1, underlying_allowed, NOW()
			FROM resolved
			ON CONFLICT (account_id, plan_product_id) DO UPDATE SET
				revision=CASE WHEN entitlement_revision.allowed IS DISTINCT FROM EXCLUDED.allowed
					THEN entitlement_revision.revision+1 ELSE entitlement_revision.revision END,
				allowed=EXCLUDED.allowed,
				updated_at=CASE WHEN entitlement_revision.allowed IS DISTINCT FROM EXCLUDED.allowed
					THEN NOW() ELSE entitlement_revision.updated_at END
			RETURNING revision
		)
		SELECT effective.allowed, revision.revision::text
		FROM effective CROSS JOIN revision
	`, accountID, incomingCallIntegrationProductID, incomingCallBlockedAccountStatusID).Scan(
		&entitlement.Allowed, &entitlement.Revision,
	)
	if err != nil {
		return incomingCallEntitlement{}, err
	}
	return entitlement, nil
}

func captureIncomingCallWebhookTargets(ctx context.Context, tx *sql.Tx, accountID, workerID string) ([]incomingCallWebhookTarget, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT webhook.outbound_webhook_id::text, webhook.channel_id::text,
			webhook.config_version
		FROM outbound_webhook webhook
		JOIN worker runtime_worker
		  ON runtime_worker.worker_id=webhook.channel_id
		 AND runtime_worker.account_id=webhook.account_id
		 AND runtime_worker.deleted_at IS NULL
		JOIN outbound_webhook_subscription subscription
		  ON subscription.outbound_webhook_id=webhook.outbound_webhook_id
		 AND subscription.event_type=$3
		 AND subscription.active=TRUE
		 AND subscription.deleted_at IS NULL
		WHERE webhook.account_id=$1::uuid AND webhook.channel_id=$2::uuid
		  AND webhook.status='active' AND webhook.deleted_at IS NULL
		  AND EXISTS (
			SELECT 1 FROM account capture_account
			WHERE capture_account.account_id=webhook.account_id
			  AND capture_account.account_status_id<>$4::uuid
			  AND capture_account.deleted_at IS NULL
			  AND EXISTS (
				SELECT 1 FROM (
					SELECT pa.plan_id, pa.next_payment_date
					FROM plan_account pa
					WHERE pa.account_id=webhook.account_id
					ORDER BY pa.updated_at DESC NULLS LAST,
						pa.created_at DESC NULLS LAST, pa.plan_account_id DESC
					LIMIT 1
				) latest_plan
				JOIN plan capture_plan ON capture_plan.plan_id=latest_plan.plan_id
				WHERE latest_plan.next_payment_date>clock_timestamp()
				  AND capture_plan.deleted_at IS NULL
			  )
		  )
		ORDER BY webhook.outbound_webhook_id
		LIMIT $5
	`, accountID, workerID, incomingCallProtocolEventType,
		incomingCallBlockedAccountStatusID, incomingCallWebhookMaxTargets+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	targets := make([]incomingCallWebhookTarget, 0)
	for rows.Next() {
		var target incomingCallWebhookTarget
		if err := rows.Scan(&target.WebhookID, &target.ChannelID, &target.ConfigVersion); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(targets) > incomingCallWebhookMaxTargets {
		return nil, errors.New("incoming call protocol webhook target limit exceeded")
	}
	return targets, nil
}

func filterExistingIncomingCallWebhookTargets(
	ctx context.Context,
	tx *sql.Tx,
	accountID string,
	routing []string,
	targets []incomingCallWebhookTarget,
) ([]incomingCallWebhookTarget, error) {
	webhookIDs := make([]string, 0, len(targets))
	for _, target := range targets {
		webhookIDs = append(webhookIDs, target.WebhookID)
	}
	rows, err := tx.QueryContext(ctx, `
		SELECT webhook.outbound_webhook_id::text, webhook.channel_id::text
		FROM outbound_webhook webhook
		JOIN worker runtime_worker
		  ON runtime_worker.worker_id=webhook.channel_id
		 AND runtime_worker.account_id=webhook.account_id
		 AND runtime_worker.deleted_at IS NULL
		WHERE webhook.account_id=$1::uuid
		  AND webhook.outbound_webhook_id=ANY($2::uuid[])
		  AND webhook.channel_id=ANY($3::uuid[])
		  AND webhook.deleted_at IS NULL
		FOR KEY SHARE OF webhook, runtime_worker
	`, accountID, pq.Array(webhookIDs), pq.Array(routing))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	existing := make(map[string]struct{}, len(targets))
	for rows.Next() {
		var webhookID, channelID string
		if err := rows.Scan(&webhookID, &channelID); err != nil {
			return nil, err
		}
		existing[strings.ToLower(webhookID)+"\x1f"+strings.ToLower(channelID)] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	result := make([]incomingCallWebhookTarget, 0, len(targets))
	for _, target := range targets {
		key := strings.ToLower(target.WebhookID) + "\x1f" + strings.ToLower(target.ChannelID)
		if _, ok := existing[key]; ok {
			result = append(result, target)
		}
	}
	return result, nil
}

func buildIncomingCallProtocolEnvelope(
	eventID string,
	occurredAt time.Time,
	input incomingCallTemplateInput,
	previous *incomingCallChat,
	current *incomingCallChat,
	protocol string,
) ([]byte, error) {
	envelope := map[string]any{
		"id":          eventID,
		"type":        incomingCallProtocolEventType,
		"api_version": "1",
		"occurred_at": occurredAt.UTC().Format(time.RFC3339Nano),
		"account_id":  input.AccountID,
		"aggregate":   map[string]any{"type": "chat", "id": current.chatID()},
		"data": map[string]any{
			"chat": publicIncomingCallChat(current),
			"changes": map[string]any{
				"protocol_type": "protocol_start",
				"protocol":      protocol,
			},
		},
		"previous": map[string]any{"chat": publicIncomingCallChat(previous)},
		"context": map[string]any{
			"source":      incomingCallProtocolEventSource,
			"channel_ids": []string{strings.ToLower(input.WorkerID)},
			"actor":       map[string]any{"type": "system"},
		},
	}
	payload, err := json.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	if len(payload) <= incomingCallWebhookMaxPayloadBytes {
		return payload, nil
	}
	envelope["data"] = map[string]any{
		"payload_omitted": true,
		"omission_reason": "payload_too_large",
	}
	envelope["previous"] = nil
	payload, err = json.Marshal(envelope)
	if err != nil {
		return nil, err
	}
	if len(payload) > incomingCallWebhookMaxPayloadBytes {
		return nil, errors.New("incoming call webhook envelope exceeds size limit")
	}
	return payload, nil
}

func publicIncomingCallChat(chat *incomingCallChat) map[string]any {
	if chat == nil {
		return map[string]any{}
	}
	keys := []string{
		"chat_id", "account", "worker", "sector", "user", "secondary_users",
		"contact", "photo", "name", "phone", "status", "date", "started_at",
		"closed_at", "protocol_ura", "protocol_start", "protocol_transfer",
		"label", "forward_to_output_chatbot", "official_window", "satisfaction_response",
	}
	result := make(map[string]any, len(keys))
	for _, key := range keys {
		value, ok := chat.Raw[key]
		if !ok {
			switch key {
			case "secondary_users", "protocol_ura", "protocol_start", "protocol_transfer", "label":
				result[incomingCallPublicKey(key)] = []any{}
			default:
				result[incomingCallPublicKey(key)] = nil
			}
			continue
		}
		result[incomingCallPublicKey(key)] = sanitizeIncomingCallWebhookValue(value, 0)
	}
	return result
}

func incomingCallPublicKey(key string) string {
	if key == "label" {
		return "labels"
	}
	return key
}

var (
	incomingCallSensitiveWebhookKey = regexp.MustCompile(`(?i)(?:^|_)(?:authorization|password|passwd|secret|token|cookie|credential|private_key|access_key|api_key|keyapi|ciphertext|base64|binary|raw|raw_payload|jwt|bearer)(?:$|_)`)
	incomingCallCamelKeyBoundary    = regexp.MustCompile(`([a-z\d])([A-Z])`)
	incomingCallNonKeyCharacter     = regexp.MustCompile(`[^a-zA-Z\d]+`)
	incomingCallInlineBase64        = regexp.MustCompile(`(?i)^data:[^,\r\n]{0,512};base64,`)
)

var incomingCallEmbeddedMediaKeys = map[string]struct{}{
	"jpeg_thumbnail":         {},
	"high_quality_thumbnail": {},
}

func sanitizeIncomingCallWebhookValue(value any, depth int) any {
	result, ok := sanitizeIncomingCallWebhookValueChecked(value, depth)
	if !ok {
		return nil
	}
	return result
}

func sanitizeIncomingCallWebhookValueChecked(value any, depth int) (any, bool) {
	if depth >= 16 {
		return nil, false
	}
	switch typed := value.(type) {
	case nil, bool, float64, json.Number:
		return typed, true
	case string:
		if len(typed) > 256*1024 {
			return typed[:256*1024] + "[truncated]", true
		}
		if incomingCallInlineBase64.MatchString(strings.TrimLeft(typed, " \t\r\n")) {
			return nil, false
		}
		return typed, true
	case []any:
		limit := min(len(typed), 2000)
		result := make([]any, 0, limit)
		for _, item := range typed[:limit] {
			if sanitized, ok := sanitizeIncomingCallWebhookValueChecked(item, depth+1); ok {
				result = append(result, sanitized)
			}
		}
		return result, true
	case []string:
		limit := min(len(typed), 2000)
		result := make([]any, 0, limit)
		for _, item := range typed[:limit] {
			if sanitized, ok := sanitizeIncomingCallWebhookValueChecked(item, depth+1); ok {
				result = append(result, sanitized)
			}
		}
		return result, true
	case map[string]any:
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		if len(keys) > 2000 {
			keys = keys[:2000]
		}
		result := make(map[string]any, len(keys))
		for _, key := range keys {
			normalized := incomingCallCamelKeyBoundary.ReplaceAllString(key, `${1}_${2}`)
			normalized = strings.ToLower(incomingCallNonKeyCharacter.ReplaceAllString(normalized, "_"))
			_, embeddedMedia := incomingCallEmbeddedMediaKeys[normalized]
			lowerKey := strings.ToLower(key)
			if incomingCallSensitiveWebhookKey.MatchString(normalized) || embeddedMedia || lowerKey == "__proto__" || lowerKey == "constructor" || lowerKey == "prototype" {
				continue
			}
			if sanitized, ok := sanitizeIncomingCallWebhookValueChecked(typed[key], depth+1); ok {
				result[key] = sanitized
			}
		}
		return result, true
	default:
		payload, err := json.Marshal(typed)
		if err != nil {
			return nil, false
		}
		var normalized any
		if json.Unmarshal(payload, &normalized) != nil {
			return nil, false
		}
		return sanitizeIncomingCallWebhookValueChecked(normalized, depth+1)
	}
}

func discardedIncomingCallWebhookPayload(payload []byte, reason string) []byte {
	var envelope map[string]any
	if json.Unmarshal(payload, &envelope) != nil {
		return payload
	}
	data := map[string]any{"discarded": true}
	if reason != "" {
		data["reason"] = reason
	}
	envelope["data"] = data
	envelope["previous"] = nil
	result, err := json.Marshal(envelope)
	if err != nil {
		return payload
	}
	return result
}
