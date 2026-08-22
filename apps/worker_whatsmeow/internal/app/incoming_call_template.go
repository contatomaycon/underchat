package app

import (
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	incomingCallElasticIndex       = "chat"
	incomingCallCacheTTL           = time.Minute
	incomingCallRenderTimeout      = 5 * time.Second
	incomingCallElasticMaxResponse = 8 * 1024 * 1024
)

var incomingCallOpenStatuses = map[string]struct{}{
	"in_chat":      {},
	"queue":        {},
	"ura":          {},
	"ura_output":   {},
	"ura_schedule": {},
	"ura_webhook":  {},
}

type incomingCallTemplateInput struct {
	AccountID   string
	AccountName string
	WorkerID    string
	WorkerName  string
	CallJID     string
	CallPhone   string
	IsVideo     bool
	Template    string
}

type incomingCallChat struct {
	Raw map[string]any
}

func (c *incomingCallChat) clone() *incomingCallChat {
	if c == nil {
		return nil
	}
	raw := make(map[string]any, len(c.Raw))
	for key, value := range c.Raw {
		raw[key] = value
	}
	return &incomingCallChat{Raw: raw}
}

func (c *incomingCallChat) chatID() string {
	return incomingCallString(c.Raw["chat_id"])
}

func (c *incomingCallChat) accountID() string {
	return incomingCallNestedString(c.Raw, "account", "id")
}

func (c *incomingCallChat) workerID() string {
	return incomingCallNestedString(c.Raw, "worker", "id")
}

func (c *incomingCallChat) phone() string {
	return incomingCallString(c.Raw["phone"])
}

func (c *incomingCallChat) status() string {
	return incomingCallString(c.Raw["status"])
}

func (c *incomingCallChat) protocol(protocolType string) string {
	values := incomingCallStringSlice(c.Raw[protocolType])
	for index := len(values) - 1; index >= 0; index-- {
		if value := strings.TrimSpace(values[index]); value != "" {
			return value
		}
	}
	return ""
}

func (c *incomingCallChat) withProtocol(protocolType, protocol string) *incomingCallChat {
	cloned := c.clone()
	values := append([]string(nil), incomingCallStringSlice(cloned.Raw[protocolType])...)
	values = append(values, protocol)
	cloned.Raw[protocolType] = values
	return cloned
}

func (c *incomingCallChat) webhookMarkers() []string {
	meta, _ := c.Raw["meta"].(map[string]any)
	return incomingCallStringSlice(meta["outbound_webhook_event_ids"])
}

func (c *incomingCallChat) hasWebhookMarker(eventID string) bool {
	for _, candidate := range c.webhookMarkers() {
		if candidate == eventID {
			return true
		}
	}
	return false
}

func incomingCallString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	default:
		return ""
	}
}

func incomingCallNestedString(value map[string]any, objectKey, fieldKey string) string {
	object, _ := value[objectKey].(map[string]any)
	return incomingCallString(object[fieldKey])
}

func incomingCallStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok {
				result = append(result, text)
			}
		}
		return result
	default:
		return nil
	}
}

func decodeIncomingCallChat(raw json.RawMessage, fallbackID string) (*incomingCallChat, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var source map[string]any
	if err := decoder.Decode(&source); err != nil {
		return nil, fmt.Errorf("decode incoming call chat: %w", err)
	}
	if source == nil {
		return nil, errors.New("incoming call chat source is empty")
	}
	if incomingCallString(source["chat_id"]) == "" && fallbackID != "" {
		source["chat_id"] = fallbackID
	}
	return &incomingCallChat{Raw: source}, nil
}

type incomingCallProtocolWriteResult string

const (
	incomingCallProtocolUpdated incomingCallProtocolWriteResult = "updated"
	incomingCallProtocolNoop    incomingCallProtocolWriteResult = "noop"
)

type incomingCallChatStore interface {
	FindOpenChat(context.Context, incomingCallTemplateInput) (*incomingCallChat, error)
	GetChat(context.Context, string, string) (*incomingCallChat, error)
	PutProtocol(context.Context, string, string, []string) (incomingCallProtocolWriteResult, error)
	CacheChat(context.Context, *incomingCallChat) error
}

type preparedIncomingCallProtocolEvent struct {
	EventID                   string
	OccurredAt                time.Time
	IntegrationEntitlementRev string
}

type incomingCallProtocolOutbox interface {
	PrepareIncomingCallProtocolEvent(
		context.Context,
		incomingCallTemplateInput,
		*incomingCallChat,
		*incomingCallChat,
		string,
	) (*preparedIncomingCallProtocolEvent, error)
	CompleteIncomingCallProtocolEvent(
		context.Context,
		incomingCallTemplateInput,
		*preparedIncomingCallProtocolEvent,
		*incomingCallChat,
		*incomingCallChat,
		string,
	) error
	CancelIncomingCallProtocolEvent(context.Context, string) error
}

func renderIncomingCallTemplateDirect(
	ctx context.Context,
	input incomingCallTemplateInput,
	chats incomingCallChatStore,
	outbox incomingCallProtocolOutbox,
) (string, error) {
	if chats == nil || outbox == nil {
		return "", errors.New("incoming call template dependencies are unavailable")
	}
	renderCtx, cancel := context.WithTimeout(ctx, incomingCallRenderTimeout)
	defer cancel()

	chat, err := chats.FindOpenChat(renderCtx, input)
	if err != nil {
		return "", err
	}
	realChat := chat != nil
	if chat == nil {
		chat = syntheticIncomingCallChat(input)
	}

	protocol := ""
	if incomingCallHasProtocolTag(input.Template) {
		protocol = chat.protocol("protocol_start")
		if protocol == "" && realChat {
			protocol, chat, err = createIncomingCallProtocol(renderCtx, input, chat, chats, outbox)
			if err != nil {
				return "", err
			}
		}
		if protocol == "" {
			protocol, err = generateIncomingCallProtocol(time.Now())
			if err != nil {
				return "", err
			}
		}
	}

	return replaceIncomingCallTemplateTags(input.Template, chat, protocol), nil
}

func createIncomingCallProtocol(
	ctx context.Context,
	input incomingCallTemplateInput,
	chat *incomingCallChat,
	chats incomingCallChatStore,
	outbox incomingCallProtocolOutbox,
) (string, *incomingCallChat, error) {
	candidate, err := generateIncomingCallProtocol(time.Now())
	if err != nil {
		return "", chat, err
	}
	intended := chat.withProtocol("protocol_start", candidate)
	prepared, err := outbox.PrepareIncomingCallProtocolEvent(ctx, input, chat, intended, candidate)
	if err != nil {
		// The canonical service treats outbound webhooks as a best-effort side
		// effect. Protocol OCC must remain available when entitlement/outbox
		// infrastructure is temporarily unavailable.
		prepared = nil
	}
	eventIDs := []string(nil)
	if prepared != nil {
		eventIDs = []string{prepared.EventID}
	}

	result, err := chats.PutProtocol(ctx, chat.chatID(), candidate, eventIDs)
	if err != nil {
		if prepared != nil {
			cancelIncomingCallProtocolBestEffort(outbox, prepared.EventID)
		}
		return "", chat, fmt.Errorf("persist incoming call protocol: %w", err)
	}

	switch result {
	case incomingCallProtocolNoop:
		if prepared != nil {
			cancelIncomingCallProtocolBestEffort(outbox, prepared.EventID)
		}
		winner, err := chats.GetChat(ctx, input.AccountID, chat.chatID())
		if err != nil {
			return "", chat, err
		}
		if winner == nil || winner.protocol("protocol_start") == "" {
			return "", chat, errors.New("incoming call protocol OCC winner is unavailable")
		}
		if err := chats.CacheChat(ctx, winner); err != nil {
			return "", chat, fmt.Errorf("cache incoming call protocol winner: %w", err)
		}
		return winner.protocol("protocol_start"), winner, nil

	case incomingCallProtocolUpdated:
		confirmed, err := chats.GetChat(ctx, input.AccountID, chat.chatID())
		if err != nil {
			return "", chat, err
		}
		if confirmed == nil {
			confirmed = intended
			if prepared != nil {
				meta, _ := confirmed.Raw["meta"].(map[string]any)
				if meta == nil {
					meta = map[string]any{}
					confirmed.Raw["meta"] = meta
				}
				markers := append(incomingCallStringSlice(meta["outbound_webhook_event_ids"]), prepared.EventID)
				meta["outbound_webhook_event_ids"] = incomingCallUniqueLast(markers, 256)
			}
		}
		if prepared != nil && confirmed.hasWebhookMarker(prepared.EventID) {
			// Completion is retryable by the shared reconciler because the marker
			// was committed atomically with the Elasticsearch mutation.
			_ = outbox.CompleteIncomingCallProtocolEvent(ctx, input, prepared, chat, confirmed, candidate)
		}
		if err := chats.CacheChat(ctx, confirmed); err != nil {
			return "", chat, fmt.Errorf("cache confirmed incoming call protocol: %w", err)
		}
		protocol := confirmed.protocol("protocol_start")
		if protocol == "" {
			protocol = candidate
		}
		return protocol, confirmed, nil

	default:
		if prepared != nil {
			cancelIncomingCallProtocolBestEffort(outbox, prepared.EventID)
		}
		return "", chat, fmt.Errorf("unexpected incoming call protocol write result %q", result)
	}
}

func cancelIncomingCallProtocolBestEffort(outbox incomingCallProtocolOutbox, eventID string) {
	if outbox == nil || strings.TrimSpace(eventID) == "" {
		return
	}
	cancelCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = outbox.CancelIncomingCallProtocolEvent(cancelCtx, eventID)
}

func syntheticIncomingCallChat(input incomingCallTemplateInput) *incomingCallChat {
	phone := incomingCallDigits(input.CallPhone)
	if phone == "" {
		phone = incomingCallPhoneFromJID(input.CallJID)
	}
	return &incomingCallChat{Raw: map[string]any{
		"chat_id": "incoming_call:" + input.WorkerID + ":" + firstNonEmpty(phone, "unknown"),
		"account": map[string]any{"id": input.AccountID, "name": input.AccountName},
		"worker":  map[string]any{"id": input.WorkerID, "name": input.WorkerName},
		"name":    nil,
		"phone":   phone,
		"status":  "queue",
		"date":    time.Now().UTC().Format(time.RFC3339Nano),
		"user":    nil,
		"sector":  nil,
		"contact": nil,
	}}
}

func incomingCallHasProtocolTag(template string) bool {
	return regexp.MustCompile(`(?i)\{\{\s*(protocol|protocolo)\s*\}\}`).MatchString(template)
}

func generateIncomingCallProtocol(now time.Time) (string, error) {
	var random [7]byte
	if _, err := cryptorand.Read(random[:]); err != nil {
		return "", fmt.Errorf("generate incoming call protocol entropy: %w", err)
	}
	digits := make([]byte, len(random))
	for index, value := range random {
		digits[index] = '0' + value%10
	}
	return now.Format("20060102") + string(digits), nil
}

func replaceIncomingCallTemplateTags(template string, chat *incomingCallChat, protocol string) string {
	now := time.Now()
	greeting := "Boa noite"
	if now.Hour() >= 5 && now.Hour() < 12 {
		greeting = "Bom dia"
	} else if now.Hour() >= 12 && now.Hour() < 18 {
		greeting = "Boa tarde"
	}
	contactName := incomingCallNestedString(chat.Raw, "contact", "name")
	if contactName == "" {
		contactName = incomingCallString(chat.Raw["name"])
	}
	if protocol == "" {
		protocol = firstNonEmpty(
			chat.protocol("protocol_start"),
			chat.protocol("protocol_transfer"),
			chat.protocol("protocol_ura"),
		)
	}
	replacements := map[string]string{
		"greeting":     greeting,
		"name":         contactName,
		"protocol":     protocol,
		"protocolo":    protocol,
		"date":         now.Format("02/01/2006"),
		"time":         now.Format("15:04"),
		"account_name": incomingCallNestedString(chat.Raw, "account", "name"),
		"accountname":  incomingCallNestedString(chat.Raw, "account", "name"),
		"phone":        formatIncomingCallPhone(chat.phone()),
		"channel_name": incomingCallNestedString(chat.Raw, "worker", "name"),
		"channelname":  incomingCallNestedString(chat.Raw, "worker", "name"),
		"sector":       incomingCallNestedString(chat.Raw, "sector", "name"),
		"user":         incomingCallNestedString(chat.Raw, "user", "name"),
	}
	result := template
	for key, value := range replacements {
		pattern := regexp.MustCompile(`(?i)\{\{\s*` + regexp.QuoteMeta(key) + `\s*\}\}`)
		result = pattern.ReplaceAllString(result, value)
	}
	return result
}

func formatIncomingCallPhone(value string) string {
	digits := incomingCallDigits(value)
	if !strings.HasPrefix(digits, "55") || len(digits) < 12 {
		return digits
	}
	body := digits[4:]
	if len(body) < 5 {
		return digits
	}
	return "+55 (" + digits[2:4] + ") " + body[:len(body)-4] + "-" + body[len(body)-4:]
}

func incomingCallUniqueLast(values []string, limit int) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	if limit > 0 && len(result) > limit {
		result = result[len(result)-limit:]
	}
	return result
}

type incomingCallIdentity struct {
	PhoneCandidates []string
	JIDCandidates   []string
	RemoteJID       string
}

func normalizeIncomingCallIdentity(phone, jid string) incomingCallIdentity {
	normalizedJID := normalizeIncomingCallJID(jid)
	phoneCandidates := incomingCallPhoneCandidates(firstNonEmpty(incomingCallDigits(phone), incomingCallPhoneFromJID(normalizedJID)))
	jidCandidates := make([]string, 0, len(phoneCandidates)*2+2)
	if normalizedJID != "" {
		jidCandidates = append(jidCandidates, normalizedJID)
		if strings.HasSuffix(normalizedJID, "@s.whatsapp.net") {
			jidCandidates = append(jidCandidates, strings.TrimSuffix(normalizedJID, "@s.whatsapp.net")+"@c.us")
		}
	}
	for _, candidate := range phoneCandidates {
		jidCandidates = append(jidCandidates, candidate+"@s.whatsapp.net", candidate+"@c.us")
	}
	return incomingCallIdentity{
		PhoneCandidates: incomingCallUniqueLast(phoneCandidates, 0),
		JIDCandidates:   incomingCallUniqueLast(jidCandidates, 0),
		RemoteJID:       normalizedJID,
	}
}

func normalizeIncomingCallJID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	parts := strings.SplitN(value, "@", 2)
	if len(parts) == 2 && (parts[1] == "s.whatsapp.net" || parts[1] == "c.us") {
		user := strings.SplitN(parts[0], ":", 2)[0]
		return user + "@s.whatsapp.net"
	}
	return value
}

func incomingCallPhoneFromJID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasSuffix(value, "@lid") {
		return ""
	}
	return incomingCallDigits(strings.SplitN(value, "@", 2)[0])
}

func incomingCallDigits(value string) string {
	var result strings.Builder
	for _, character := range value {
		if character >= '0' && character <= '9' {
			result.WriteRune(character)
		}
	}
	return result.String()
}

func incomingCallPhoneCandidates(value string) []string {
	value = incomingCallDigits(value)
	if value == "" {
		return nil
	}
	if !strings.HasPrefix(value, "55") || len(value) < 12 {
		return []string{value}
	}
	rest := value[2:]
	if len(rest) < 10 {
		return []string{value}
	}
	ddd, local := rest[:2], rest[2:]
	withoutNine := local
	if len(local) == 9 && strings.HasPrefix(local, "9") {
		withoutNine = local[1:]
	}
	withNine := local
	if len(local) == 8 {
		withNine = "9" + local
	}
	withoutNine = "55" + ddd + withoutNine
	withNine = "55" + ddd + withNine
	fallback := withNine
	if value == withNine {
		fallback = withoutNine
	}
	return incomingCallUniqueLast([]string{value, fallback}, 0)
}

type elasticIncomingCallChatStore struct {
	cfg    Config
	redis  *redis.Client
	client *http.Client
}

func newElasticIncomingCallChatStore(cfg Config, redisClient *redis.Client) *elasticIncomingCallChatStore {
	return &elasticIncomingCallChatStore{
		cfg:    cfg,
		redis:  redisClient,
		client: &http.Client{Timeout: incomingCallRenderTimeout},
	}
}

func (s *elasticIncomingCallChatStore) FindOpenChat(ctx context.Context, input incomingCallTemplateInput) (*incomingCallChat, error) {
	identity := normalizeIncomingCallIdentity(input.CallPhone, input.CallJID)
	if len(identity.PhoneCandidates) == 0 && len(identity.JIDCandidates) == 0 {
		return nil, nil
	}
	if s.redis != nil {
		for _, phone := range identity.PhoneCandidates {
			key := incomingCallPhoneCacheKey(input.AccountID, input.WorkerID, phone)
			cached, err := s.redis.Get(ctx, key).Bytes()
			if err == nil {
				chat, decodeErr := decodeIncomingCallChat(cached, "")
				if decodeErr != nil {
					return nil, decodeErr
				}
				if chat.accountID() == input.AccountID && chat.workerID() == input.WorkerID && incomingCallIsOpenStatus(chat.status()) {
					_ = s.patchMissingMessageKey(ctx, chat, identity.RemoteJID)
					return chat, nil
				}
				if err := s.redis.Del(ctx, key).Err(); err != nil {
					return nil, err
				}
				continue
			}
			if !errors.Is(err, redis.Nil) {
				// Match safeRedisGet in the canonical Node implementation: a cache
				// outage is a miss and Elasticsearch remains authoritative.
				continue
			}
		}
	}

	should := make([]any, 0, 3)
	if len(identity.PhoneCandidates) > 0 {
		should = append(should, map[string]any{"terms": map[string]any{"phone": identity.PhoneCandidates}})
	}
	if len(identity.JIDCandidates) > 0 {
		should = append(should,
			map[string]any{"nested": map[string]any{"path": "message_key", "query": map[string]any{"terms": map[string]any{"message_key.remote_jid": identity.JIDCandidates}}}},
			map[string]any{"nested": map[string]any{"path": "message_key", "query": map[string]any{"terms": map[string]any{"message_key.remote_jid_alt": identity.JIDCandidates}}}},
		)
	}
	body := map[string]any{
		"size":    1,
		"_source": true,
		"sort":    []any{map[string]any{"date": map[string]any{"order": "asc"}}},
		"query": map[string]any{"bool": map[string]any{"filter": []any{
			map[string]any{"nested": map[string]any{"path": "account", "query": map[string]any{"term": map[string]any{"account.id": input.AccountID}}}},
			map[string]any{"nested": map[string]any{"path": "worker", "query": map[string]any{"term": map[string]any{"worker.id": input.WorkerID}}}},
			map[string]any{"terms": map[string]any{"status": []string{"in_chat", "queue", "ura", "ura_output", "ura_schedule", "ura_webhook"}}},
			map[string]any{"bool": map[string]any{"should": should, "minimum_should_match": 1}},
		}}},
	}
	var response struct {
		Hits struct {
			Hits []struct {
				ID     string          `json:"_id"`
				Source json.RawMessage `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := s.doJSON(ctx, http.MethodPost, "/"+incomingCallElasticIndex+"/_search", nil, body, &response); err != nil {
		return nil, err
	}
	if len(response.Hits.Hits) == 0 {
		return nil, nil
	}
	chat, err := decodeIncomingCallChat(response.Hits.Hits[0].Source, response.Hits.Hits[0].ID)
	if err != nil {
		return nil, err
	}
	_ = s.patchMissingMessageKey(ctx, chat, identity.RemoteJID)
	if err := s.CacheChat(ctx, chat); err != nil {
		return nil, err
	}
	return chat, nil
}

func incomingCallIsOpenStatus(status string) bool {
	_, ok := incomingCallOpenStatuses[status]
	return ok
}

func (s *elasticIncomingCallChatStore) GetChat(ctx context.Context, accountID, chatID string) (*incomingCallChat, error) {
	var direct struct {
		Found  bool            `json:"found"`
		Source json.RawMessage `json:"_source"`
	}
	err := s.doJSON(ctx, http.MethodGet, "/"+incomingCallElasticIndex+"/_doc/"+url.PathEscape(chatID), nil, nil, &direct)
	if err == nil && direct.Found && len(direct.Source) > 0 {
		chat, decodeErr := decodeIncomingCallChat(direct.Source, chatID)
		if decodeErr != nil {
			return nil, decodeErr
		}
		if chat.accountID() != accountID {
			return nil, nil
		}
		return chat, nil
	}
	if err != nil && !errors.Is(err, errIncomingCallElasticNotFound) {
		return nil, err
	}

	body := map[string]any{
		"size":    1,
		"_source": true,
		"query": map[string]any{"bool": map[string]any{
			"must":   []any{map[string]any{"nested": map[string]any{"path": "account", "query": map[string]any{"term": map[string]any{"account.id": accountID}}}}},
			"filter": []any{map[string]any{"term": map[string]any{"chat_id": chatID}}},
		}},
	}
	var response struct {
		Hits struct {
			Hits []struct {
				ID     string          `json:"_id"`
				Source json.RawMessage `json:"_source"`
			} `json:"hits"`
		} `json:"hits"`
	}
	if err := s.doJSON(ctx, http.MethodPost, "/"+incomingCallElasticIndex+"/_search", nil, body, &response); err != nil {
		return nil, err
	}
	if len(response.Hits.Hits) == 0 {
		return nil, nil
	}
	return decodeIncomingCallChat(response.Hits.Hits[0].Source, response.Hits.Hits[0].ID)
}

func (s *elasticIncomingCallChatStore) PutProtocol(ctx context.Context, chatID, protocol string, eventIDs []string) (incomingCallProtocolWriteResult, error) {
	body := map[string]any{"script": map[string]any{
		"lang": "painless",
		"source": `
            def protocols = ctx._source[params.protocol_type];
            if (protocols != null) {
              for (def existingProtocol : protocols) {
                if (existingProtocol != null && existingProtocol instanceof String && existingProtocol.trim().length() > 0) {
                  ctx.op = 'noop';
                  return;
                }
              }
            }

            ctx._source[params.protocol_type] = [params.protocol];
            if (params.outbound_webhook_event_ids != null && !params.outbound_webhook_event_ids.isEmpty()) {
              if (ctx._source.meta == null) ctx._source.meta = [:];
              if (ctx._source.meta.outbound_webhook_event_ids == null) {
                ctx._source.meta.outbound_webhook_event_ids = [];
              }
              for (def eventId : params.outbound_webhook_event_ids) {
                if (!ctx._source.meta.outbound_webhook_event_ids.contains(eventId)) {
                  ctx._source.meta.outbound_webhook_event_ids.add(eventId);
                }
              }
              while (ctx._source.meta.outbound_webhook_event_ids.size() > 256) {
                ctx._source.meta.outbound_webhook_event_ids.remove(0);
              }
            }
          `,
		"params": map[string]any{
			"protocol_type":              "protocol_start",
			"protocol":                   protocol,
			"outbound_webhook_event_ids": eventIDs,
		},
	}}
	query := url.Values{"retry_on_conflict": []string{"5"}, "refresh": []string{"true"}}
	var response struct {
		Result string `json:"result"`
	}
	if err := s.doJSON(ctx, http.MethodPost, "/"+incomingCallElasticIndex+"/_update/"+url.PathEscape(chatID), query, body, &response); err != nil {
		return "", err
	}
	switch response.Result {
	case string(incomingCallProtocolUpdated):
		return incomingCallProtocolUpdated, nil
	case string(incomingCallProtocolNoop):
		return incomingCallProtocolNoop, nil
	default:
		return "", fmt.Errorf("Elasticsearch protocol update returned result=%s", response.Result)
	}
}

func (s *elasticIncomingCallChatStore) patchMissingMessageKey(ctx context.Context, chat *incomingCallChat, remoteJID string) error {
	if chat == nil || remoteJID == "" {
		return nil
	}
	messageKey, _ := chat.Raw["message_key"].(map[string]any)
	if incomingCallString(messageKey["remote_jid"]) != "" {
		return nil
	}
	body := map[string]any{"script": map[string]any{
		"lang": "painless",
		"source": `
          if (ctx._source == null) { ctx.op = 'noop'; return; }
          if (ctx._source.message_key == null) { ctx._source.message_key = [:]; }
          def changed = false;
          if (params.remote_jid != null && ctx._source.message_key.remote_jid == null) {
            ctx._source.message_key.remote_jid = params.remote_jid;
            changed = true;
          }
          if (!changed) { ctx.op = 'noop'; }
        `,
		"params": map[string]any{"remote_jid": remoteJID},
	}}
	query := url.Values{"retry_on_conflict": []string{"5"}}
	var response struct {
		Result string `json:"result"`
	}
	if err := s.doJSON(ctx, http.MethodPost, "/"+incomingCallElasticIndex+"/_update/"+url.PathEscape(chat.chatID()), query, body, &response); err != nil {
		return err
	}
	if messageKey == nil {
		messageKey = map[string]any{}
		chat.Raw["message_key"] = messageKey
	}
	messageKey["remote_jid"] = remoteJID
	return s.CacheChat(ctx, chat)
}

func (s *elasticIncomingCallChatStore) CacheChat(ctx context.Context, chat *incomingCallChat) error {
	if s.redis == nil || chat == nil {
		return errors.New("incoming call Redis cache is unavailable")
	}
	payload, err := json.Marshal(chat.Raw)
	if err != nil {
		return err
	}
	keys := []string{incomingCallChatIDCacheKey(chat.accountID(), chat.chatID())}
	if phone := chat.phone(); phone != "" && chat.workerID() != "" {
		keys = append(keys, incomingCallPhoneCacheKey(chat.accountID(), chat.workerID(), phone))
	}
	pipe := s.redis.Pipeline()
	for _, key := range keys {
		pipe.Set(ctx, key, payload, incomingCallCacheTTL)
	}
	_, err = pipe.Exec(ctx)
	return err
}

func incomingCallPhoneCacheKey(accountID, workerID, phone string) string {
	return strings.Join([]string{"underchat", "chat", accountID, workerID, phone}, ":")
}

func incomingCallChatIDCacheKey(accountID, chatID string) string {
	return strings.Join([]string{"chat", accountID, chatID}, ":")
}

var errIncomingCallElasticNotFound = errors.New("incoming call Elasticsearch document not found")

func (s *elasticIncomingCallChatStore) doJSON(
	ctx context.Context,
	method, endpoint string,
	query url.Values,
	body any,
	result any,
) error {
	base := strings.TrimRight(strings.TrimSpace(s.cfg.ElasticURL), "/")
	if base == "" {
		return errors.New("public Elasticsearch endpoint is not configured")
	}
	parsed, err := url.Parse(base + endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return errors.New("public Elasticsearch endpoint is invalid")
	}
	if query != nil {
		parsed.RawQuery = query.Encode()
	}
	var reader io.Reader
	if body != nil {
		payload, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(payload)
	}
	request, err := http.NewRequestWithContext(ctx, method, parsed.String(), reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/vnd.elasticsearch+json")
	request.Header.Set("Content-Type", "application/vnd.elasticsearch+json")
	if s.cfg.ElasticUsername != "" || s.cfg.ElasticPassword != "" {
		request.SetBasicAuth(s.cfg.ElasticUsername, s.cfg.ElasticPassword)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return errors.New("Elasticsearch request failed")
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return errIncomingCallElasticNotFound
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Elasticsearch request rejected status=%d", response.StatusCode)
	}
	if result == nil {
		return nil
	}
	limited := io.LimitReader(response.Body, incomingCallElasticMaxResponse+1)
	payload, err := io.ReadAll(limited)
	if err != nil {
		return errors.New("read Elasticsearch response failed")
	}
	if len(payload) > incomingCallElasticMaxResponse {
		return errors.New("Elasticsearch response exceeds incoming call limit")
	}
	if err := json.Unmarshal(payload, result); err != nil {
		return errors.New("decode Elasticsearch response failed")
	}
	return nil
}
