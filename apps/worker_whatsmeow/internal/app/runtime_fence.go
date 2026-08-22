package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc/codes"
	grpcstatus "google.golang.org/grpc/status"
)

const whatsAppRuntimeFenceKeyPrefix = "whatsapp:runtime-fence:v1"
const whatsAppRuntimeFenceActivationLockTTL = 60 * time.Second
const whatsAppRuntimeFenceActivationOrdersTTL = 30 * 24 * time.Hour
const whatsAppRuntimeEffectLeaseRegistryTTL = time.Hour
const whatsAppRuntimeFenceRetryInitialCap = 100 * time.Millisecond
const whatsAppRuntimeFenceRetryMaximumCap = 2 * time.Second

var errWhatsAppRuntimeFenceRevoked = errors.New("WhatsApp runtime fence is not active")
var errWhatsAppRuntimeFenceActivationRejected = errors.New("WhatsApp runtime fence activation rejected")

const beginWhatsAppRuntimeFenceActivationScript = `
local incoming_generation = tonumber(ARGV[1]) or 0
local incoming_epoch = ARGV[2]
local incoming_provider = ARGV[3]
local incoming_worker = ARGV[4]
local lock_ttl_ms = tonumber(ARGV[5]) or 0
local lock_owner = ARGV[1] .. string.char(31) .. incoming_epoch
local order_field = ARGV[1] .. string.char(31) .. incoming_provider
  .. string.char(31) .. incoming_epoch

local current_raw = redis.call('GET', KEYS[1])
local current = nil
if current_raw then
  local decoded, value = pcall(cjson.decode, current_raw)
  if decoded then
    current = value
    local current_generation = tonumber(current.runtime_generation) or 0
    local current_sequence = tonumber(current.connection_sequence) or 0
    local current_order = tonumber(current.activation_order) or 0
    local current_activated_at = tonumber(current.activated_at) or 0
    if current_generation == incoming_generation and current_order > 0 then
      local order_counter = tonumber(redis.call('HGET', KEYS[3], '__counter')) or 0
      if order_counter < current_order then
        redis.call('HSET', KEYS[3], '__counter', current_order)
      end
    end
    if current_generation == incoming_generation
      and tostring(current.connection_epoch or '') == incoming_epoch
      and tostring(current.source_provider or '') == incoming_provider
      and tostring(current.state or '') == 'active'
      and current_sequence > 0
      and current_order > 0
      and current_activated_at > 0 then
      if redis.call('GET', KEYS[2]) == lock_owner then
        redis.call('DEL', KEYS[2])
      end
      redis.call('HSET', KEYS[3], order_field, current_order)
      redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))
      return {4, current_order, current_activated_at, current_sequence, 0}
    end
  end
end

local activation_order = tonumber(redis.call('HGET', KEYS[3], order_field))
if not activation_order then
  activation_order = redis.call('HINCRBY', KEYS[3], '__counter', 1)
  redis.call('HSET', KEYS[3], order_field, activation_order)
end
redis.call('EXPIRE', KEYS[3], tonumber(ARGV[6]))

if current then
  local current_generation = tonumber(current.runtime_generation) or 0
  local current_order = tonumber(current.activation_order) or 0
  if current_generation > incoming_generation
    or (current_generation == incoming_generation and current_order > activation_order)
    or (current_generation == incoming_generation
      and current_order == activation_order
      and (tostring(current.connection_epoch or '') ~= incoming_epoch
        or tostring(current.source_provider or '') ~= incoming_provider)) then
    if redis.call('GET', KEYS[2]) == lock_owner then
      redis.call('DEL', KEYS[2])
    end
    return {3, activation_order, 0, 0, 0}
  end
end

local activated_at = 0
if current
  and tonumber(current.runtime_generation) == incoming_generation
  and tonumber(current.activation_order) == activation_order
  and tostring(current.connection_epoch or '') == incoming_epoch
  and tostring(current.source_provider or '') == incoming_provider
  and tostring(current.state or '') == 'activating' then
  activated_at = tonumber(current.activated_at) or 0
end
if activated_at <= 0 then
  local redis_time = redis.call('TIME')
  activated_at = (tonumber(redis_time[1]) * 1000)
    + math.floor(tonumber(redis_time[2]) / 1000)
end

redis.call('SET', KEYS[1], cjson.encode({
  state = 'activating',
  worker_id = incoming_worker,
  runtime_generation = incoming_generation,
  connection_epoch = incoming_epoch,
  connection_sequence = 0,
  source_provider = incoming_provider,
  activated_at = activated_at,
  activation_order = activation_order
}))

local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000)
  + math.floor(tonumber(redis_time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[4], '-inf', now_ms)
for _, lease_id in ipairs(expired) do
  redis.call('HDEL', KEYS[5], lease_id)
end
if #expired > 0 then
  redis.call('ZREM', KEYS[4], unpack(expired))
end
local active_effect_leases = redis.call('ZCARD', KEYS[4])
if active_effect_leases > 0 then
  if redis.call('GET', KEYS[2]) == lock_owner then
    redis.call('DEL', KEYS[2])
  end
  return {5, activation_order, activated_at, 0, active_effect_leases}
end
redis.call('DEL', KEYS[4], KEYS[5])

local current_lock_owner = redis.call('GET', KEYS[2])
if not current_lock_owner then
  local acquired = redis.call('SET', KEYS[2], lock_owner, 'PX', lock_ttl_ms, 'NX')
  if acquired then
    return {1, activation_order, activated_at, 0, 0}
  end
  current_lock_owner = redis.call('GET', KEYS[2])
end
if current_lock_owner == lock_owner then
  redis.call('PEXPIRE', KEYS[2], lock_ttl_ms)
  return {1, activation_order, activated_at, 0, 0}
end
return {2, activation_order, activated_at, 0, 0}
`

const finalizeWhatsAppRuntimeFenceActivationScript = `
local incoming_generation = tonumber(ARGV[1]) or 0
local incoming_epoch = ARGV[2]
local incoming_provider = ARGV[3]
local incoming_order = tonumber(ARGV[4]) or 0
local incoming_sequence = tonumber(ARGV[5]) or 0
local lock_owner = ARGV[1] .. string.char(31) .. incoming_epoch

local current_raw = redis.call('GET', KEYS[1])
if current_raw then
  local decoded, current = pcall(cjson.decode, current_raw)
  if decoded
    and tonumber(current.runtime_generation) == incoming_generation
    and tostring(current.connection_epoch or '') == incoming_epoch
    and tostring(current.source_provider or '') == incoming_provider
    and tonumber(current.activation_order) == incoming_order then
    if tostring(current.state or '') == 'active'
      and tonumber(current.connection_sequence) == incoming_sequence then
      if redis.call('GET', KEYS[2]) == lock_owner then
        redis.call('DEL', KEYS[2])
      end
      return 1
    end
    if tostring(current.state or '') == 'activating'
      and redis.call('GET', KEYS[2]) == lock_owner
      and incoming_sequence > 0 then
      local redis_time = redis.call('TIME')
      local now_ms = (tonumber(redis_time[1]) * 1000)
        + math.floor(tonumber(redis_time[2]) / 1000)
      local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now_ms)
      for _, lease_id in ipairs(expired) do
        redis.call('HDEL', KEYS[4], lease_id)
      end
      if #expired > 0 then
        redis.call('ZREM', KEYS[3], unpack(expired))
      end
      if redis.call('ZCARD', KEYS[3]) > 0 then
        return 0
      end
      redis.call('DEL', KEYS[3], KEYS[4])
      current.state = 'active'
      current.connection_sequence = incoming_sequence
      redis.call('SET', KEYS[1], cjson.encode(current))
      redis.call('DEL', KEYS[2])
      return 1
    end
  end
end

if redis.call('GET', KEYS[2]) == lock_owner then
  redis.call('DEL', KEYS[2])
end
return 0
`

const acquireWhatsAppRuntimeEffectLeaseScript = `
local expected_worker = ARGV[1]
local expected_generation = tonumber(ARGV[2]) or 0
local expected_epoch = ARGV[3]
local expected_provider = ARGV[4]
local lease_id = ARGV[5]
local owner_token = ARGV[6]
local lease_ttl_ms = tonumber(ARGV[7]) or 0
local registry_ttl_ms = tonumber(ARGV[8]) or 0

local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000)
  + math.floor(tonumber(redis_time[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now_ms)
for _, expired_id in ipairs(expired) do
  redis.call('HDEL', KEYS[3], expired_id)
end
if #expired > 0 then
  redis.call('ZREM', KEYS[2], unpack(expired))
end

local current_raw = redis.call('GET', KEYS[1])
if not current_raw then
  return {0}
end
local decoded, current = pcall(cjson.decode, current_raw)
if not decoded
  or tostring(current.state or '') ~= 'active'
  or tostring(current.worker_id or '') ~= expected_worker
  or tostring(current.source_provider or '') ~= expected_provider
  or (tonumber(current.connection_sequence) or 0) <= 0
  or (tonumber(current.activation_order) or 0) <= 0 then
  return {0}
end
if (tonumber(current.runtime_generation) or 0) ~= expected_generation
  or tostring(current.connection_epoch or '') ~= expected_epoch then
  return {0}
end

local expires_at = now_ms + lease_ttl_ms
redis.call('HSET', KEYS[3], lease_id, owner_token)
redis.call('ZADD', KEYS[2], expires_at, lease_id)
redis.call('PEXPIRE', KEYS[2], registry_ttl_ms)
redis.call('PEXPIRE', KEYS[3], registry_ttl_ms)
return {1, current_raw, expires_at}
`

const renewWhatsAppRuntimeEffectLeaseScript = `
local lease_id = ARGV[1]
local owner_token = ARGV[2]
local lease_ttl_ms = tonumber(ARGV[3]) or 0
local registry_ttl_ms = tonumber(ARGV[4]) or 0
if redis.call('HGET', KEYS[2], lease_id) ~= owner_token then
  return {0, 0}
end
local redis_time = redis.call('TIME')
local now_ms = (tonumber(redis_time[1]) * 1000)
  + math.floor(tonumber(redis_time[2]) / 1000)
local current_expiry = tonumber(redis.call('ZSCORE', KEYS[1], lease_id)) or 0
if current_expiry <= now_ms then
  redis.call('HDEL', KEYS[2], lease_id)
  redis.call('ZREM', KEYS[1], lease_id)
  return {0, current_expiry}
end
local expires_at = now_ms + lease_ttl_ms
redis.call('ZADD', KEYS[1], expires_at, lease_id)
redis.call('PEXPIRE', KEYS[1], registry_ttl_ms)
redis.call('PEXPIRE', KEYS[2], registry_ttl_ms)
return {1, expires_at}
`

const releaseWhatsAppRuntimeEffectLeaseScript = `
local lease_id = ARGV[1]
local owner_token = ARGV[2]
if redis.call('HGET', KEYS[2], lease_id) ~= owner_token then
  return 0
end
redis.call('HDEL', KEYS[2], lease_id)
redis.call('ZREM', KEYS[1], lease_id)
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1], KEYS[2])
end
return 1
`

const deactivateWhatsAppRuntimeFenceScript = `
local lock_owner = ARGV[1] .. string.char(31) .. ARGV[2]
local changed = 0
local current_raw = redis.call('GET', KEYS[1])
if current_raw then
  local decoded, current = pcall(cjson.decode, current_raw)
  if not decoded then
    redis.call('DEL', KEYS[1])
    changed = 1
  elseif tostring(current.runtime_generation or '') == ARGV[1]
    and tostring(current.connection_epoch or '') == ARGV[2] then
    redis.call('DEL', KEYS[1])
    changed = 1
  end
end
if redis.call('GET', KEYS[2]) == lock_owner then
  redis.call('DEL', KEYS[2])
  changed = 1
end
return changed
`

type whatsAppRuntimeFence struct {
	State              string `json:"state"`
	WorkerID           string `json:"worker_id"`
	RuntimeGeneration  int    `json:"runtime_generation"`
	ConnectionEpoch    string `json:"connection_epoch"`
	ConnectionSequence int64  `json:"connection_sequence"`
	SourceProvider     string `json:"source_provider"`
	ActivatedAt        int64  `json:"activated_at"`
	ActivationOrder    int64  `json:"activation_order"`
}

type whatsAppRuntimeFenceBeginResult struct {
	Status             string
	ActivationOrder    int64
	ActivatedAt        int64
	ConnectionSequence int64
	ActiveEffectLeases int64
}

type inboundConnectionScopeContextKey struct{}

type whatsAppRuntimeEffectLease struct {
	redis       *redis.Client
	fence       whatsAppRuntimeFence
	leasesKey   string
	ownersKey   string
	leaseID     string
	ownerToken  string
	ttl         time.Duration
	heartbeat   time.Duration
	registryTTL time.Duration
	stop        chan struct{}
	done        chan struct{}
	stopOnce    sync.Once
	mu          sync.Mutex
	expiresAt   time.Time
	released    bool
	lost        bool
}

func whatsAppRuntimeFenceKey(workerID string) string {
	return fmt.Sprintf("%s:%s", whatsAppRuntimeFenceKeyPrefix, strings.TrimSpace(workerID))
}

func whatsAppRuntimeFenceActivationLockKey(workerID string) string {
	return fmt.Sprintf("%s:%s:activation-lock", whatsAppRuntimeFenceKeyPrefix, strings.TrimSpace(workerID))
}

func whatsAppRuntimeFenceActivationOrdersKey(workerID string, runtimeGeneration int) string {
	return fmt.Sprintf(
		"%s:%s:activation-orders:%d",
		whatsAppRuntimeFenceKeyPrefix,
		strings.TrimSpace(workerID),
		runtimeGeneration,
	)
}

func whatsAppRuntimeEffectLeasesKey(workerID string) string {
	return fmt.Sprintf("%s:%s:effect-leases", whatsAppRuntimeFenceKeyPrefix, strings.TrimSpace(workerID))
}

func whatsAppRuntimeEffectLeaseOwnersKey(workerID string) string {
	return fmt.Sprintf("%s:%s:effect-lease-owners", whatsAppRuntimeFenceKeyPrefix, strings.TrimSpace(workerID))
}

func withInboundConnectionScope(ctx context.Context, scope whatsAppRuntimeFence) context.Context {
	return context.WithValue(ctx, inboundConnectionScopeContextKey{}, scope)
}

func inboundConnectionScopeFromContext(ctx context.Context) (whatsAppRuntimeFence, bool) {
	if ctx == nil {
		return whatsAppRuntimeFence{}, false
	}
	scope, ok := ctx.Value(inboundConnectionScopeContextKey{}).(whatsAppRuntimeFence)
	return scope, ok && scope.isValid()
}

func (scope whatsAppRuntimeFence) isValid() bool {
	return scope.State == "active" &&
		strings.TrimSpace(scope.WorkerID) != "" &&
		scope.RuntimeGeneration > 0 &&
		strings.TrimSpace(scope.ConnectionEpoch) != "" &&
		scope.ConnectionSequence > 0 &&
		scope.SourceProvider == "whatsmeow" &&
		scope.ActivatedAt > 0 &&
		scope.ActivationOrder > 0
}

func sameWhatsAppRuntimeFenceIdentity(left, right whatsAppRuntimeFence) bool {
	return left.WorkerID == right.WorkerID &&
		left.RuntimeGeneration == right.RuntimeGeneration &&
		left.ConnectionEpoch == right.ConnectionEpoch &&
		left.SourceProvider == right.SourceProvider
}

func runtimeFenceResultInt64(value any) (int64, bool) {
	switch typed := value.(type) {
	case int64:
		return typed, true
	case string:
		var parsed int64
		if _, err := fmt.Sscan(typed, &parsed); err == nil {
			return parsed, true
		}
	case []byte:
		var parsed int64
		if _, err := fmt.Sscan(string(typed), &parsed); err == nil {
			return parsed, true
		}
	}
	return 0, false
}

func runtimeFenceResultBytes(value any) ([]byte, bool) {
	switch typed := value.(type) {
	case string:
		return []byte(typed), true
	case []byte:
		return typed, true
	default:
		return nil, false
	}
}

func (lease *whatsAppRuntimeEffectLease) assertOwned() error {
	if lease == nil {
		return errWhatsAppRuntimeFenceRevoked
	}
	lease.mu.Lock()
	defer lease.mu.Unlock()
	if lease.released || lease.lost || !time.Now().Before(lease.expiresAt) {
		lease.lost = true
		return errWhatsAppRuntimeFenceRevoked
	}
	return nil
}

func (lease *whatsAppRuntimeEffectLease) renew(ctx context.Context) error {
	if lease == nil {
		return errWhatsAppRuntimeFenceRevoked
	}
	lease.mu.Lock()
	if lease.released || lease.lost {
		lease.mu.Unlock()
		return errWhatsAppRuntimeFenceRevoked
	}
	lease.mu.Unlock()

	raw, err := lease.redis.Eval(
		ctx,
		renewWhatsAppRuntimeEffectLeaseScript,
		[]string{lease.leasesKey, lease.ownersKey},
		lease.leaseID,
		lease.ownerToken,
		lease.ttl.Milliseconds(),
		lease.registryTTL.Milliseconds(),
	).Slice()
	if err != nil {
		lease.mu.Lock()
		if !time.Now().Before(lease.expiresAt) {
			lease.lost = true
		}
		lease.mu.Unlock()
		return err
	}
	if len(raw) < 2 {
		lease.mu.Lock()
		lease.lost = true
		lease.mu.Unlock()
		return errWhatsAppRuntimeFenceRevoked
	}
	accepted, acceptedOK := runtimeFenceResultInt64(raw[0])
	expiresAt, expiresAtOK := runtimeFenceResultInt64(raw[1])
	if !acceptedOK || accepted != 1 || !expiresAtOK || expiresAt <= time.Now().UnixMilli() {
		lease.mu.Lock()
		lease.lost = true
		lease.mu.Unlock()
		return errWhatsAppRuntimeFenceRevoked
	}
	lease.mu.Lock()
	if !lease.released {
		lease.expiresAt = time.UnixMilli(expiresAt)
	}
	lease.mu.Unlock()
	return nil
}

func (lease *whatsAppRuntimeEffectLease) startHeartbeat() {
	go func() {
		defer close(lease.done)
		ticker := time.NewTicker(lease.heartbeat)
		defer ticker.Stop()
		for {
			select {
			case <-lease.stop:
				return
			case <-ticker.C:
				ctx, cancel := context.WithTimeout(context.Background(), min(lease.heartbeat, 5*time.Second))
				err := lease.renew(ctx)
				cancel()
				if errors.Is(err, errWhatsAppRuntimeFenceRevoked) {
					return
				}
			}
		}
	}()
}

// abandonHeartbeat fences any later provider authorization immediately, but
// deliberately leaves the owner-token lease in Redis until its TTL expires.
// This is the safe handoff for a handler that ignored cancellation: deleting
// its lease would let a replacement runtime overlap an effect that may still
// be executing.
func (lease *whatsAppRuntimeEffectLease) abandonHeartbeat() {
	if lease == nil {
		return
	}
	lease.mu.Lock()
	lease.lost = true
	lease.mu.Unlock()
	lease.stopOnce.Do(func() {
		close(lease.stop)
	})
}

func (lease *whatsAppRuntimeEffectLease) release(ctx context.Context) (bool, error) {
	if lease == nil {
		return false, nil
	}
	lease.mu.Lock()
	lease.released = true
	lease.mu.Unlock()
	lease.stopOnce.Do(func() {
		close(lease.stop)
	})
	select {
	case <-lease.done:
	case <-ctx.Done():
		return false, ctx.Err()
	}
	result, err := lease.redis.Eval(
		ctx,
		releaseWhatsAppRuntimeEffectLeaseScript,
		[]string{lease.leasesKey, lease.ownersKey},
		lease.leaseID,
		lease.ownerToken,
	).Int()
	return result == 1, err
}

func (m *WhatsAppManager) acquireRuntimeEffectLease(
	ctx context.Context,
	expected whatsAppRuntimeFence,
) (*whatsAppRuntimeEffectLease, error) {
	if m == nil || m.redis == nil {
		return nil, errors.New("redis is required for WhatsApp runtime effect leasing")
	}
	workerID := strings.TrimSpace(expected.WorkerID)
	provider := strings.TrimSpace(expected.SourceProvider)
	if workerID == "" || provider != "whatsmeow" || !expected.isValid() {
		return nil, nil
	}
	leaseID := uuid.NewString()
	ownerToken := uuid.NewString()
	leasesKey := whatsAppRuntimeEffectLeasesKey(workerID)
	ownersKey := whatsAppRuntimeEffectLeaseOwnersKey(workerID)
	leaseTTL, leaseHeartbeat := normalizeRuntimeEffectLeaseDurations(
		m.cfg.RuntimeEffectLeaseTTL,
		m.cfg.RuntimeEffectLeaseHeartbeat,
	)
	registryTTL := max(whatsAppRuntimeEffectLeaseRegistryTTL, leaseTTL*3)
	raw, err := m.redis.Eval(
		ctx,
		acquireWhatsAppRuntimeEffectLeaseScript,
		[]string{whatsAppRuntimeFenceKey(workerID), leasesKey, ownersKey},
		workerID,
		expected.RuntimeGeneration,
		expected.ConnectionEpoch,
		provider,
		leaseID,
		ownerToken,
		leaseTTL.Milliseconds(),
		registryTTL.Milliseconds(),
	).Slice()
	if err != nil {
		return nil, err
	}
	if len(raw) < 1 {
		return nil, errors.New("invalid Redis runtime effect lease result")
	}
	accepted, acceptedOK := runtimeFenceResultInt64(raw[0])
	if !acceptedOK || accepted != 1 {
		return nil, nil
	}
	if len(raw) < 3 {
		return nil, errors.New("invalid Redis runtime effect lease result")
	}
	var active whatsAppRuntimeFence
	activeRaw, activeRawOK := runtimeFenceResultBytes(raw[1])
	if !activeRawOK {
		return nil, errors.New("invalid active runtime fence in effect lease")
	}
	if err := json.Unmarshal(activeRaw, &active); err != nil || !active.isValid() {
		_, _ = m.redis.Eval(
			ctx,
			releaseWhatsAppRuntimeEffectLeaseScript,
			[]string{leasesKey, ownersKey},
			leaseID,
			ownerToken,
		).Result()
		if err != nil {
			return nil, err
		}
		return nil, errors.New("invalid active runtime fence in effect lease")
	}
	expiresAt, expiresAtOK := runtimeFenceResultInt64(raw[2])
	if !expiresAtOK || expiresAt <= time.Now().UnixMilli() {
		_, _ = m.redis.Eval(
			ctx,
			releaseWhatsAppRuntimeEffectLeaseScript,
			[]string{leasesKey, ownersKey},
			leaseID,
			ownerToken,
		).Result()
		return nil, errors.New("invalid Redis runtime effect lease expiry")
	}
	lease := &whatsAppRuntimeEffectLease{
		redis:       m.redis,
		fence:       active,
		leasesKey:   leasesKey,
		ownersKey:   ownersKey,
		leaseID:     leaseID,
		ownerToken:  ownerToken,
		ttl:         leaseTTL,
		heartbeat:   leaseHeartbeat,
		registryTTL: registryTTL,
		stop:        make(chan struct{}),
		done:        make(chan struct{}),
		expiresAt:   time.UnixMilli(expiresAt),
	}
	lease.startHeartbeat()
	return lease, nil
}

func (m *WhatsAppManager) acquireActiveRuntimeEffectLease(
	ctx context.Context,
) (*whatsAppRuntimeEffectLease, error) {
	scope, ok := m.currentInboundConnectionScope()
	if !ok {
		return nil, nil
	}
	return m.acquireRuntimeEffectLease(ctx, scope)
}

func (m *WhatsAppManager) beginRuntimeFenceActivation(
	ctx context.Context,
	scope whatsAppRuntimeFence,
) (whatsAppRuntimeFenceBeginResult, error) {
	raw, err := m.redis.Eval(
		ctx,
		beginWhatsAppRuntimeFenceActivationScript,
		[]string{
			whatsAppRuntimeFenceKey(scope.WorkerID),
			whatsAppRuntimeFenceActivationLockKey(scope.WorkerID),
			whatsAppRuntimeFenceActivationOrdersKey(scope.WorkerID, scope.RuntimeGeneration),
			whatsAppRuntimeEffectLeasesKey(scope.WorkerID),
			whatsAppRuntimeEffectLeaseOwnersKey(scope.WorkerID),
		},
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
		scope.SourceProvider,
		scope.WorkerID,
		whatsAppRuntimeFenceActivationLockTTL.Milliseconds(),
		int64(whatsAppRuntimeFenceActivationOrdersTTL/time.Second),
	).Slice()
	if err != nil {
		return whatsAppRuntimeFenceBeginResult{}, err
	}
	if len(raw) < 5 {
		return whatsAppRuntimeFenceBeginResult{}, errors.New("invalid Redis runtime-fence begin result")
	}
	code, codeOK := runtimeFenceResultInt64(raw[0])
	order, orderOK := runtimeFenceResultInt64(raw[1])
	activatedAt, activatedAtOK := runtimeFenceResultInt64(raw[2])
	sequence, sequenceOK := runtimeFenceResultInt64(raw[3])
	activeEffectLeases, activeEffectLeasesOK := runtimeFenceResultInt64(raw[4])
	status := map[int64]string{
		1: "acquired",
		2: "waiting",
		3: "superseded",
		4: "active",
		5: "draining",
	}[code]
	if !codeOK || !orderOK || order <= 0 || status == "" ||
		(status != "superseded" && (!activatedAtOK || activatedAt <= 0)) ||
		(status == "active" && (!sequenceOK || sequence <= 0)) ||
		!activeEffectLeasesOK || activeEffectLeases < 0 ||
		(status == "draining" && activeEffectLeases <= 0) {
		return whatsAppRuntimeFenceBeginResult{}, errors.New("invalid Redis runtime-fence begin result")
	}
	return whatsAppRuntimeFenceBeginResult{
		Status:             status,
		ActivationOrder:    order,
		ActivatedAt:        activatedAt,
		ConnectionSequence: sequence,
		ActiveEffectLeases: activeEffectLeases,
	}, nil
}

func (m *WhatsAppManager) finalizeRuntimeFenceActivation(
	ctx context.Context,
	scope whatsAppRuntimeFence,
) (bool, error) {
	result, err := m.redis.Eval(
		ctx,
		finalizeWhatsAppRuntimeFenceActivationScript,
		[]string{
			whatsAppRuntimeFenceKey(scope.WorkerID),
			whatsAppRuntimeFenceActivationLockKey(scope.WorkerID),
			whatsAppRuntimeEffectLeasesKey(scope.WorkerID),
			whatsAppRuntimeEffectLeaseOwnersKey(scope.WorkerID),
		},
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
		scope.SourceProvider,
		scope.ActivationOrder,
		scope.ConnectionSequence,
	).Int()
	return result == 1, err
}

func nextWhatsAppRuntimeFenceRetryCap(current time.Duration) time.Duration {
	if current <= 0 {
		return whatsAppRuntimeFenceRetryInitialCap
	}
	if current >= whatsAppRuntimeFenceRetryMaximumCap ||
		current > whatsAppRuntimeFenceRetryMaximumCap/2 {
		return whatsAppRuntimeFenceRetryMaximumCap
	}
	return current * 2
}

func whatsAppRuntimeFenceRetryFullJitter(
	cap time.Duration,
	random func() uint64,
) time.Duration {
	if cap <= 0 {
		return 0
	}
	if cap > whatsAppRuntimeFenceRetryMaximumCap {
		cap = whatsAppRuntimeFenceRetryMaximumCap
	}
	if random == nil {
		random = randUint64
	}
	// Inclusive [0, cap] full jitter. The activation cap is at most two
	// seconds, so cap+1 cannot overflow either time.Duration or uint64.
	return time.Duration(random() % (uint64(cap) + 1))
}

func (m *WhatsAppManager) waitWhatsAppRuntimeFenceRetry(
	ctx context.Context,
	cap time.Duration,
) error {
	if ctx == nil {
		return context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	delay := whatsAppRuntimeFenceRetryFullJitter(
		cap,
		m.runtimeFenceRetryRandom,
	)
	if delay <= 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return nil
		}
	}

	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func normalizeAuthorizedRuntimeConnectionFence(
	connectionAttemptID string,
	connectionEpoch string,
) (*WhatsappRuntimeOwnedConnectionFence, error) {
	connectionAttemptID = strings.TrimSpace(connectionAttemptID)
	connectionEpoch = strings.TrimSpace(connectionEpoch)
	if connectionEpoch == "" {
		return nil, nil
	}
	if connectionAttemptID == "" {
		return nil, errors.New("authorized connection epoch requires connection_attempt_id")
	}
	if _, err := uuid.Parse(connectionAttemptID); err != nil {
		return nil, errors.New("authorized connection attempt is invalid")
	}
	if _, err := uuid.Parse(connectionEpoch); err != nil {
		return nil, errors.New("authorized connection epoch is invalid")
	}
	return &WhatsappRuntimeOwnedConnectionFence{
		ConnectionEpoch:     connectionEpoch,
		ConnectionAttemptID: connectionAttemptID,
	}, nil
}

func (m *WhatsAppManager) currentOwnedRuntimeConnectionFence() (*WhatsappRuntimeOwnedConnectionFence, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.ownedRuntimeConnectionFence == nil {
		return nil, false
	}
	captured := *m.ownedRuntimeConnectionFence
	if captured.ConnectionEpoch == "" || captured.ConnectionAttemptID == "" {
		return nil, false
	}
	return &captured, true
}

func runtimeFenceActivationIdentity(
	owned *WhatsappRuntimeOwnedConnectionFence,
	randomEpoch func() string,
) (connectionEpoch string, connectionAttemptID string, err error) {
	if owned != nil {
		normalized, normalizeErr := normalizeAuthorizedRuntimeConnectionFence(
			owned.ConnectionAttemptID,
			owned.ConnectionEpoch,
		)
		if normalizeErr != nil || normalized == nil {
			return "", "", errors.New("owned WhatsApp runtime connection fence is invalid")
		}
		return normalized.ConnectionEpoch, normalized.ConnectionAttemptID, nil
	}
	if randomEpoch == nil {
		return "", "", errors.New("runtime connection epoch generator is unavailable")
	}
	connectionEpoch = strings.TrimSpace(randomEpoch())
	if _, parseErr := uuid.Parse(connectionEpoch); parseErr != nil {
		return "", "", errors.New("generated runtime connection epoch is invalid")
	}
	return connectionEpoch, "", nil
}

func (m *WhatsAppManager) rotateInboundConnectionScope(ctx context.Context) (whatsAppRuntimeFence, error) {
	owned, _ := m.currentOwnedRuntimeConnectionFence()
	return m.rotateInboundConnectionScopeWithOwnership(ctx, owned)
}

func (m *WhatsAppManager) rotateInboundConnectionScopeWithOwnership(
	ctx context.Context,
	owned *WhatsappRuntimeOwnedConnectionFence,
) (whatsAppRuntimeFence, error) {
	connectionEpoch, connectionAttemptID, err := runtimeFenceActivationIdentity(
		owned,
		uuid.NewString,
	)
	if err != nil {
		return whatsAppRuntimeFence{}, err
	}
	return m.rotateInboundConnectionScopeWithIdentity(
		ctx,
		connectionEpoch,
		connectionAttemptID,
	)
}

func (m *WhatsAppManager) rotateInboundConnectionScopeWithIdentity(
	ctx context.Context,
	connectionEpoch string,
	connectionAttemptID string,
) (whatsAppRuntimeFence, error) {
	if m.isProviderProcessQuarantined() {
		return whatsAppRuntimeFence{}, fmt.Errorf(
			"%w: provider process is quarantined; restart is required before runtime activation",
			errWhatsmeowProviderClientFenced,
		)
	}
	if m.redis == nil {
		return whatsAppRuntimeFence{}, errors.New("redis is required for WhatsApp runtime fencing")
	}
	if m.cfg.RuntimeGeneration <= 0 {
		return whatsAppRuntimeFence{}, errors.New("runtime_generation must be positive for WhatsApp runtime fencing")
	}

	connectionEpoch = strings.TrimSpace(connectionEpoch)
	connectionAttemptID = strings.TrimSpace(connectionAttemptID)
	if _, err := uuid.Parse(connectionEpoch); err != nil {
		return whatsAppRuntimeFence{}, errors.New("runtime connection epoch is invalid")
	}
	if connectionAttemptID != "" {
		authorized, err := normalizeAuthorizedRuntimeConnectionFence(
			connectionAttemptID,
			connectionEpoch,
		)
		if err != nil || authorized == nil {
			if err == nil {
				err = errors.New("runtime connection authorization is invalid")
			}
			return whatsAppRuntimeFence{}, err
		}
	}

	scope := whatsAppRuntimeFence{
		WorkerID:          m.cfg.WorkerID,
		RuntimeGeneration: m.cfg.RuntimeGeneration,
		ConnectionEpoch:   connectionEpoch,
		SourceProvider:    "whatsmeow",
	}
	if m.activateRuntimeFence == nil {
		return whatsAppRuntimeFence{}, errors.New("durable WhatsApp runtime fence activation is unavailable")
	}
	activationRequest := WhatsappRuntimeFenceActivationRequest{
		WorkerID:            scope.WorkerID,
		AccountID:           m.cfg.AccountID,
		SourceProvider:      scope.SourceProvider,
		RuntimeGeneration:   scope.RuntimeGeneration,
		ConnectionEpoch:     scope.ConnectionEpoch,
		ConnectionAttemptID: connectionAttemptID,
	}
	var durable *WhatsappRuntimeFenceActivationResponse
	retryCap := whatsAppRuntimeFenceRetryInitialCap
	waitForRetry := func() error {
		err := m.waitWhatsAppRuntimeFenceRetry(ctx, retryCap)
		if err == nil {
			retryCap = nextWhatsAppRuntimeFenceRetryCap(retryCap)
		}
		return err
	}
	cleanupActivation := func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
		_, _ = m.redis.Eval(
			cleanupCtx,
			deactivateWhatsAppRuntimeFenceScript,
			[]string{
				whatsAppRuntimeFenceKey(scope.WorkerID),
				whatsAppRuntimeFenceActivationLockKey(scope.WorkerID),
			},
			scope.RuntimeGeneration,
			scope.ConnectionEpoch,
		).Result()
		cleanupCancel()
	}
	persistDurably := func() error {
		rpcCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		response, activationErr := m.activateRuntimeFence(rpcCtx, activationRequest)
		cancel()
		if activationErr != nil {
			return activationErr
		}
		durable = &response
		scope.ConnectionSequence = response.ConnectionSequence
		return nil
	}
	isTerminalActivationError := func(activationErr error) bool {
		if errors.Is(activationErr, errWhatsAppRuntimeFenceActivationRejected) {
			return true
		}
		switch grpcstatus.Code(activationErr) {
		case codes.InvalidArgument, codes.PermissionDenied, codes.Unauthenticated, codes.FailedPrecondition:
			return true
		default:
			return false
		}
	}
	for {
		begin, err := m.beginRuntimeFenceActivation(ctx, scope)
		if err != nil {
			if retryErr := waitForRetry(); retryErr != nil {
				return whatsAppRuntimeFence{}, retryErr
			}
			continue
		}
		if begin.Status == "superseded" {
			return whatsAppRuntimeFence{}, errors.New("a newer WhatsApp runtime fence activation superseded this connection")
		}
		scope.ActivationOrder = begin.ActivationOrder
		if begin.ActivatedAt > 0 {
			scope.ActivatedAt = begin.ActivatedAt
		}
		if begin.Status == "active" {
			scope.State = "active"
			// An authorized epoch is never trusted from Redis alone. The durable
			// activation consumes or revalidates the exact attempt grant before
			// the provider may touch its auth store.
			if connectionAttemptID != "" && durable == nil {
				activationErr := persistDurably()
				if activationErr != nil {
					if isTerminalActivationError(activationErr) {
						cleanupActivation()
						return whatsAppRuntimeFence{}, fmt.Errorf("persist WhatsApp runtime fence: %w", activationErr)
					}
					if retryErr := waitForRetry(); retryErr != nil {
						return whatsAppRuntimeFence{}, fmt.Errorf("persist WhatsApp runtime fence: %w", retryErr)
					}
					continue
				}
			} else if durable == nil {
				scope.ConnectionSequence = begin.ConnectionSequence
			}
			break
		}
		if begin.Status == "waiting" || begin.Status == "draining" {
			if retryErr := waitForRetry(); retryErr != nil {
				return whatsAppRuntimeFence{}, retryErr
			}
			continue
		}

		if durable == nil {
			activationErr := persistDurably()
			if activationErr != nil {
				if isTerminalActivationError(activationErr) {
					cleanupActivation()
					return whatsAppRuntimeFence{}, fmt.Errorf("persist WhatsApp runtime fence: %w", activationErr)
				}
				if retryErr := waitForRetry(); retryErr != nil {
					return whatsAppRuntimeFence{}, fmt.Errorf("persist WhatsApp runtime fence: %w", retryErr)
				}
				continue
			}
		}

		finalized, finalizeErr := m.finalizeRuntimeFenceActivation(ctx, scope)
		if finalizeErr == nil && finalized {
			scope.State = "active"
			break
		}
		if retryErr := waitForRetry(); retryErr != nil {
			return whatsAppRuntimeFence{}, retryErr
		}
	}
	if !scope.isValid() {
		return whatsAppRuntimeFence{}, errors.New("invalid active WhatsApp runtime fence")
	}

	m.mu.Lock()
	m.inboundConnectionScope = &scope
	m.mu.Unlock()

	return scope, nil
}

func (m *WhatsAppManager) replaceInboundConnectionScope(ctx context.Context) (whatsAppRuntimeFence, error) {
	m.inboundFenceMu.Lock()
	m.mu.RLock()
	var previous *whatsAppRuntimeFence
	if m.inboundConnectionScope != nil {
		captured := *m.inboundConnectionScope
		previous = &captured
	}
	m.mu.RUnlock()
	scope, err := m.rotateInboundConnectionScope(ctx)
	m.inboundFenceMu.Unlock()
	if err != nil {
		return whatsAppRuntimeFence{}, err
	}
	m.scheduleInboundSpoolCleanup(scope, previous)
	return scope, nil
}

func (m *WhatsAppManager) preactivateAuthorizedRuntimeConnectionFence(
	ctx context.Context,
	connectionAttemptID string,
	connectionEpoch string,
) (whatsAppRuntimeFence, error) {
	owned, err := normalizeAuthorizedRuntimeConnectionFence(
		connectionAttemptID,
		connectionEpoch,
	)
	if err != nil || owned == nil {
		if err == nil {
			err = errors.New("authorized runtime connection fence is missing")
		}
		return whatsAppRuntimeFence{}, err
	}

	m.inboundFenceMu.Lock()
	m.mu.RLock()
	var previous *whatsAppRuntimeFence
	if m.inboundConnectionScope != nil {
		captured := *m.inboundConnectionScope
		previous = &captured
	}
	currentOwned := m.ownedRuntimeConnectionFence
	currentScope := m.inboundConnectionScope
	if currentOwned != nil && currentScope != nil &&
		currentOwned.ConnectionAttemptID == owned.ConnectionAttemptID &&
		currentOwned.ConnectionEpoch == owned.ConnectionEpoch &&
		currentScope.ConnectionEpoch == owned.ConnectionEpoch &&
		currentScope.isValid() {
		captured := *currentScope
		m.mu.RUnlock()
		if err := m.verifyInboundConnectionScope(ctx, captured); err == nil {
			m.inboundFenceMu.Unlock()
			return captured, nil
		}
	} else {
		m.mu.RUnlock()
	}

	scope, activationErr := m.rotateInboundConnectionScopeWithOwnership(ctx, owned)
	if activationErr == nil {
		m.mu.Lock()
		m.ownedRuntimeConnectionFence = owned
		m.mu.Unlock()
	}
	m.inboundFenceMu.Unlock()
	if activationErr != nil {
		return whatsAppRuntimeFence{}, activationErr
	}
	m.scheduleInboundSpoolCleanup(scope, previous)
	return scope, nil
}

func (m *WhatsAppManager) currentInboundConnectionScope() (whatsAppRuntimeFence, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.inboundConnectionScope == nil || !m.inboundConnectionScope.isValid() {
		return whatsAppRuntimeFence{}, false
	}
	return *m.inboundConnectionScope, true
}

func (m *WhatsAppManager) isOutboundProviderScopeBlocked(
	scope whatsAppRuntimeFence,
) bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.outboundStalledScope != nil &&
		sameWhatsAppRuntimeFenceIdentity(*m.outboundStalledScope, scope)
}

func (m *WhatsAppManager) deactivateInboundConnectionScope(ctx context.Context) {
	m.deactivateCapturedInboundConnectionScope(ctx, nil)
}

func (m *WhatsAppManager) deactivateCapturedInboundConnectionScope(
	ctx context.Context,
	expected *whatsAppRuntimeFence,
) bool {
	scope, detached := m.detachCapturedInboundConnectionScope(expected)
	if !detached {
		return false
	}
	m.cleanupDetachedInboundConnectionScope(ctx, scope)
	return true
}

func (m *WhatsAppManager) detachCapturedInboundConnectionScope(
	expected *whatsAppRuntimeFence,
) (whatsAppRuntimeFence, bool) {
	m.inboundFenceMu.Lock()
	defer m.inboundFenceMu.Unlock()
	return m.detachCapturedInboundConnectionScopeLocal(expected)
}

func (m *WhatsAppManager) detachCapturedInboundConnectionScopeLocal(
	expected *whatsAppRuntimeFence,
) (whatsAppRuntimeFence, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	scope := m.inboundConnectionScope
	if expected != nil &&
		(scope == nil || !sameWhatsAppRuntimeFenceIdentity(*scope, *expected)) {
		return whatsAppRuntimeFence{}, false
	}
	m.inboundConnectionScope = nil
	if scope == nil {
		return whatsAppRuntimeFence{}, false
	}
	return *scope, true
}

func (m *WhatsAppManager) cleanupDetachedInboundConnectionScope(
	ctx context.Context,
	scope whatsAppRuntimeFence,
) {
	// Do not delete the durable inbound stream on a transient disconnect. The
	// next active connection re-homes its stable event IDs before publishing;
	// deleting here lost messages captured immediately before a Kafka outage or
	// reconnect.
	if m.redis == nil {
		return
	}
	if _, err := m.redis.Eval(
		ctx,
		deactivateWhatsAppRuntimeFenceScript,
		[]string{
			whatsAppRuntimeFenceKey(m.cfg.WorkerID),
			whatsAppRuntimeFenceActivationLockKey(m.cfg.WorkerID),
		},
		scope.RuntimeGeneration,
		scope.ConnectionEpoch,
	).Result(); err != nil {
		log.Printf(
			"whatsmeow runtime fence deactivate failed worker_id=%s generation=%d epoch=%s error_code=%s",
			m.cfg.WorkerID,
			scope.RuntimeGeneration,
			scope.ConnectionEpoch,
			safeOperationalErrorCode(err),
		)
	}
}

func (m *WhatsAppManager) isInboundConnectionScopeCurrent(ctx context.Context) bool {
	captured, ok := inboundConnectionScopeFromContext(ctx)
	if !ok {
		return false
	}
	return m.verifyInboundConnectionScope(ctx, captured) == nil
}

func (m *WhatsAppManager) isInboundConnectionScopeLocallyCurrent(ctx context.Context) bool {
	captured, ok := inboundConnectionScopeFromContext(ctx)
	if !ok {
		return false
	}
	local, ok := m.currentInboundConnectionScope()
	return ok && sameWhatsAppRuntimeFenceIdentity(local, captured)
}

// verifyInboundConnectionScope keeps a durable Redis outage distinct from an
// actual fence revocation. Callers that control Kafka offsets can therefore
// fail closed without dismantling a healthy consumer generation merely because
// the control plane was temporarily unavailable.
func (m *WhatsAppManager) verifyInboundConnectionScope(
	ctx context.Context,
	captured whatsAppRuntimeFence,
) error {
	if ctx == nil {
		return context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if !captured.isValid() {
		return errWhatsAppRuntimeFenceRevoked
	}
	local, ok := m.currentInboundConnectionScope()
	if !ok || !sameWhatsAppRuntimeFenceIdentity(local, captured) {
		return errWhatsAppRuntimeFenceRevoked
	}
	if m.redis == nil {
		return errors.New("redis is required to verify the WhatsApp runtime fence")
	}

	raw, err := m.redis.Get(
		ctx,
		whatsAppRuntimeFenceKey(captured.WorkerID),
	).Bytes()
	if errors.Is(err, redis.Nil) {
		return errWhatsAppRuntimeFenceRevoked
	}
	if err != nil {
		return fmt.Errorf("read WhatsApp runtime fence: %w", err)
	}
	var active whatsAppRuntimeFence
	if err := json.Unmarshal(raw, &active); err != nil || !active.isValid() {
		return errWhatsAppRuntimeFenceRevoked
	}
	if active != captured {
		return errWhatsAppRuntimeFenceRevoked
	}
	return nil
}

func (m *WhatsAppManager) captureActiveConnectionScope(ctx context.Context) (whatsAppRuntimeFence, error) {
	if ctx == nil {
		return whatsAppRuntimeFence{}, context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return whatsAppRuntimeFence{}, err
	}
	if m.isProviderProcessQuarantined() {
		return whatsAppRuntimeFence{}, errOutboundProviderCallStalled
	}
	scope, ok := m.currentInboundConnectionScope()
	if !ok {
		return whatsAppRuntimeFence{}, errWhatsAppRuntimeFenceRevoked
	}
	if m.isOutboundProviderScopeBlocked(scope) {
		return whatsAppRuntimeFence{}, errOutboundProviderCallStalled
	}
	if err := m.verifyInboundConnectionScope(ctx, scope); err != nil {
		return whatsAppRuntimeFence{}, err
	}
	return scope, nil
}

func (m *WhatsAppManager) assertCapturedConnectionScope(ctx context.Context, scope whatsAppRuntimeFence) error {
	if ctx == nil {
		return context.Canceled
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if m.isProviderProcessQuarantined() {
		return errOutboundProviderCallStalled
	}
	if !scope.isValid() {
		return errWhatsAppRuntimeFenceRevoked
	}
	if m.isOutboundProviderScopeBlocked(scope) {
		return errOutboundProviderCallStalled
	}
	return m.verifyInboundConnectionScope(ctx, scope)
}
