package app

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

const (
	typingSimulationDefaultSpeed           = 50
	typingSimulationTTL                    = 7 * 24 * time.Hour
	typingSimulationPresenceCleanupTimeout = 2 * time.Second
	typingSimulationCancellationGrace      = 100 * time.Millisecond
)

var typingSimulationPunctuationPattern = regexp.MustCompile(`[.,!?;:]`)

var errTypingSimulationLocalDeadline = errors.New("typing simulation local deadline exceeded")
var errTypingSimulationSaturated = errors.New("typing simulation concurrency limit reached")

type typingSimulationLimiter struct {
	slots chan struct{}
}

func newTypingSimulationLimiter(limit int) *typingSimulationLimiter {
	limit = normalizeTypingSimulationMaxOrphans(limit)
	return &typingSimulationLimiter{slots: make(chan struct{}, limit)}
}

func (l *typingSimulationLimiter) tryAcquire() bool {
	if l == nil {
		return true
	}
	select {
	case l.slots <- struct{}{}:
		return true
	default:
		return false
	}
}

func (l *typingSimulationLimiter) release() {
	if l == nil {
		return
	}
	<-l.slots
}

func (m *WhatsAppManager) workerTypingSimulationLimiter() *typingSimulationLimiter {
	if m == nil {
		return nil
	}
	m.typingSimulationLimiterOnce.Do(func() {
		m.typingSimulationLimiter = newTypingSimulationLimiter(m.cfg.TypingSimulationMaxOrphans)
	})
	return m.typingSimulationLimiter
}

type chatPresenceSender interface {
	SendChatPresence(context.Context, types.JID, types.ChatPresence, types.ChatPresenceMedia) error
}

type typingSimulationCachePayload struct {
	Enabled *bool `json:"enabled"`
	Speed   *int  `json:"speed"`
}

func defaultTypingSimulationConfig() TypingSimulationConfig {
	return TypingSimulationConfig{
		Enabled: true,
		Speed:   typingSimulationDefaultSpeed,
	}
}

func validTypingSimulationSpeed(speed int) bool {
	return speed >= 0 && speed <= 100
}

func normalizeTypingSimulationConfig(config TypingSimulationConfig) TypingSimulationConfig {
	speed := config.Speed
	if speed < 0 {
		speed = 0
	}
	if speed > 100 {
		speed = 100
	}
	return TypingSimulationConfig{
		Enabled: config.Enabled,
		Speed:   speed,
	}
}

func typingSimulationCacheKey(workerID string) string {
	return "worker:" + workerID + ":typing_simulation"
}

func parseTypingSimulationCachePayload(raw string) (TypingSimulationConfig, bool) {
	var payload typingSimulationCachePayload
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return TypingSimulationConfig{}, false
	}
	if payload.Enabled == nil || payload.Speed == nil || !validTypingSimulationSpeed(*payload.Speed) {
		return TypingSimulationConfig{}, false
	}
	return TypingSimulationConfig{
		Enabled: *payload.Enabled,
		Speed:   *payload.Speed,
	}, true
}

func (m *WhatsAppManager) getTypingSimulationConfig(ctx context.Context) TypingSimulationConfig {
	defaultConfig := defaultTypingSimulationConfig()
	if strings.TrimSpace(m.cfg.WorkerID) == "" || strings.TrimSpace(m.cfg.AccountID) == "" {
		return defaultConfig
	}
	if m.postgres == nil {
		return defaultConfig
	}

	cacheKey := typingSimulationCacheKey(m.cfg.WorkerID)
	if m.redis != nil {
		raw, err := m.redis.Get(ctx, cacheKey).Result()
		switch {
		case err == nil:
			if cached, ok := parseTypingSimulationCachePayload(raw); ok {
				return cached
			}
			_ = m.redis.Del(ctx, cacheKey).Err()
		case err != nil && err != redis.Nil:
			log.Printf("whatsmeow typing simulation redis get failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		}
	}

	config, err := m.postgres.GetTypingSimulationConfig(ctx, m.cfg)
	if err != nil {
		log.Printf("whatsmeow typing simulation fetch failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
		return defaultConfig
	}

	config = normalizeTypingSimulationConfig(config)
	if m.redis != nil {
		if payload, err := json.Marshal(config); err == nil {
			if err := m.redis.Set(ctx, cacheKey, string(payload), typingSimulationTTL).Err(); err != nil {
				log.Printf("whatsmeow typing simulation redis set failed worker_id=%s error_code=%s", m.cfg.WorkerID, safeOperationalErrorCode(err))
			}
		}
	}

	return config
}

func (m *WhatsAppManager) simulateTypingBeforeSend(ctx context.Context, client *whatsmeow.Client, target types.JID, text string) error {
	maxDelay := m.cfg.TypingSimulationMaxDelay
	if maxDelay <= 0 {
		maxDelay = defaultTypingSimulationMaxDelay
	}
	maxDelay = normalizeTypingSimulationMaxDelay(maxDelay)
	providerReserve := m.cfg.TypingSimulationProviderReserve
	if providerReserve <= 0 {
		providerReserve = defaultTypingSimulationProviderReserve
	}

	err := runTypingSimulationBestEffortWithLimiter(ctx, maxDelay, providerReserve, m.workerTypingSimulationLimiter(), func(typingCtx context.Context) error {
		config := m.getTypingSimulationConfig(typingCtx)
		if !config.Enabled {
			return nil
		}
		return simulateHumanTyping(typingCtx, client, target, text, config.Speed)
	})
	if err == nil {
		return nil
	}

	reason := "presence_error"
	switch {
	case errors.Is(err, errTypingSimulationLocalDeadline):
		reason = "local_deadline"
	case errors.Is(err, errTypingSimulationSaturated):
		reason = "orphan_limit"
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		reason = "parent_context_done"
	case errors.Is(err, errWhatsAppRuntimeFenceRevoked):
		reason = "runtime_fence_revoked"
	}
	log.Printf(
		"whatsmeow typing simulation skipped worker_id=%s jid=%s reason=%s error_code=%s",
		m.cfg.WorkerID,
		target.String(),
		reason,
		safeOperationalErrorCode(err),
	)
	return err
}

// runTypingSimulationBestEffort gives presence simulation its own deadline.
// The child is canceled when its local budget expires, while the parent stays
// alive for the actual WhatsApp send. A parent cancellation is deliberately
// returned unchanged so callers can forbid crossing the provider boundary.
func runTypingSimulationBestEffort(
	parent context.Context,
	maxDelay time.Duration,
	providerReserve time.Duration,
	simulate func(context.Context) error,
) error {
	return runTypingSimulationBestEffortWithLimiter(
		parent,
		maxDelay,
		providerReserve,
		nil,
		simulate,
	)
}

func runTypingSimulationBestEffortWithLimiter(
	parent context.Context,
	maxDelay time.Duration,
	providerReserve time.Duration,
	limiter *typingSimulationLimiter,
	simulate func(context.Context) error,
) error {
	if parent == nil {
		return context.Canceled
	}
	if err := parent.Err(); err != nil {
		return err
	}
	if simulate == nil {
		return errors.New("typing simulation callback is required")
	}

	budget := typingSimulationBudget(parent, maxDelay, providerReserve)
	if budget <= 0 {
		if err := parent.Err(); err != nil {
			return err
		}
		return fmt.Errorf("%w: no time remains before provider reserve", errTypingSimulationLocalDeadline)
	}
	if !limiter.tryAcquire() {
		return errTypingSimulationSaturated
	}

	typingCtx, cancel := context.WithTimeout(parent, budget)
	result := make(chan error, 1)
	go func() {
		defer limiter.release()
		// The buffer is intentional: a dependency that returns only after this
		// function has enforced its hard cap must still be able to exit without
		// leaving a goroutine blocked on delivery.
		result <- simulate(typingCtx)
	}()

	select {
	case err := <-result:
		childErr := typingCtx.Err()
		parentErr := parent.Err()
		cancel()
		if parentErr != nil {
			return parentErr
		}
		if errors.Is(childErr, context.DeadlineExceeded) ||
			errors.Is(err, context.DeadlineExceeded) {
			return fmt.Errorf("%w after %s", errTypingSimulationLocalDeadline, budget)
		}
		return err
	case <-parent.Done():
		cancel()
		return parent.Err()
	case <-typingCtx.Done():
		if parentErr := parent.Err(); parentErr != nil {
			cancel()
			return parentErr
		}

		// Give context-aware dependencies a small window to unwind and run
		// deferred presence cleanup. The grace itself is bounded: callbacks
		// that ignore context (Redis, gRPC, or presence implementations) can
		// never keep the Kafka handler from reaching the real send.
		cancel()
		grace := time.NewTimer(typingSimulationCancellationGrace)
		defer grace.Stop()
		select {
		case <-result:
		case <-parent.Done():
			return parent.Err()
		case <-grace.C:
		}
		return fmt.Errorf("%w after %s", errTypingSimulationLocalDeadline, budget)
	}
}

func typingSimulationBudget(ctx context.Context, maxDelay time.Duration, providerReserve time.Duration) time.Duration {
	if maxDelay <= 0 {
		return 0
	}
	if providerReserve < 0 {
		providerReserve = 0
	}
	budget := maxDelay
	if deadline, ok := ctx.Deadline(); ok {
		available := time.Until(deadline) - providerReserve
		if available <= 0 {
			return 0
		}
		if available < budget {
			budget = available
		}
	}
	return budget
}

func simulateHumanTyping(ctx context.Context, client chatPresenceSender, target types.JID, text string, speed int) error {
	duration := time.Duration(float64(estimateTypingDuration(text)) * typingSimulationDelayMultiplier(speed))
	authorize := providerAuthorizationGuardFromContext(ctx)
	presenceActive := false
	defer func() {
		if !presenceActive {
			return
		}
		// A local typing deadline (or a canceled parent) must not leave the chat
		// indefinitely in "composing". WithoutCancel keeps the captured provider
		// guard/runtime-fence values, while a fresh short timeout bounds cleanup.
		cleanupBase := context.WithoutCancel(ctx)
		cleanupCtx, cancel := context.WithTimeout(
			cleanupBase,
			typingSimulationPresenceCleanupTimeout,
		)
		defer cancel()
		// Keep cleanup inside the limiter-owned simulation goroutine. If a
		// provider implementation ignores this timeout, the slot remains held
		// and the per-worker orphan cap prevents unbounded cleanup goroutines.
		_ = invokeProviderAuthorizedErrorCall(cleanupCtx, authorize, func(invokeCtx context.Context) error {
			return client.SendChatPresence(invokeCtx, target, types.ChatPresencePaused, types.ChatPresenceMediaText)
		})
	}()

	if err := sleepWithContext(ctx, randDuration(100*time.Millisecond, 450*time.Millisecond)); err != nil {
		return err
	}

	if err := invokeProviderAuthorizedErrorCall(ctx, authorize, func(invokeCtx context.Context) error {
		return client.SendChatPresence(invokeCtx, target, types.ChatPresenceComposing, types.ChatPresenceMediaText)
	}); err != nil {
		return err
	}
	presenceActive = true

	start := time.Now()
	for time.Since(start) < duration {
		remaining := duration - time.Since(start)
		tick := randDuration(600*time.Millisecond, 1200*time.Millisecond)
		if tick > remaining {
			tick = remaining
		}
		if err := sleepWithContext(ctx, tick); err != nil {
			return err
		}

		if time.Since(start) >= duration {
			break
		}

		if randFloat() < 0.12 {
			if err := invokeProviderAuthorizedErrorCall(ctx, authorize, func(invokeCtx context.Context) error {
				return client.SendChatPresence(invokeCtx, target, types.ChatPresencePaused, types.ChatPresenceMediaText)
			}); err != nil {
				return err
			}
			if err := sleepWithContext(ctx, randDuration(250*time.Millisecond, 750*time.Millisecond)); err != nil {
				return err
			}
		}

		if err := invokeProviderAuthorizedErrorCall(ctx, authorize, func(invokeCtx context.Context) error {
			return client.SendChatPresence(invokeCtx, target, types.ChatPresenceComposing, types.ChatPresenceMediaText)
		}); err != nil {
			return err
		}
	}

	if err := sleepWithContext(ctx, randDuration(75*time.Millisecond, 250*time.Millisecond)); err != nil {
		return err
	}

	err := invokeProviderAuthorizedErrorCall(ctx, authorize, func(invokeCtx context.Context) error {
		return client.SendChatPresence(invokeCtx, target, types.ChatPresencePaused, types.ChatPresenceMediaText)
	})
	if err == nil {
		presenceActive = false
	}
	return err
}

func typingSimulationDelayMultiplier(speed int) float64 {
	normalized := speed
	if normalized < 0 {
		normalized = 0
	}
	if normalized > 100 {
		normalized = 100
	}
	return math.Max(0.15, math.Min(1, 1-float64(normalized)/100))
}

func estimateTypingDuration(text string) time.Duration {
	length := len([]rune(text))
	if length == 0 {
		return randDuration(300*time.Millisecond, 700*time.Millisecond)
	}

	baseCps := randInt(7, 12)
	base := time.Duration(float64(length)/float64(baseCps)*1000) * time.Millisecond
	punctuationPause := time.Duration(len(typingSimulationPunctuationPattern.FindAllString(text, -1))*randInt(80, 220)) * time.Millisecond
	newlinePause := time.Duration(strings.Count(text, "\n")*randInt(120, 320)) * time.Millisecond
	jitter := time.Duration(float64(base) * (float64(randInt(-5, 12)) / 100))
	total := base + punctuationPause + newlinePause + jitter

	if total < 500*time.Millisecond {
		return 500 * time.Millisecond
	}

	return total
}

func typingSimulationText(data ChatMessage) (string, bool) {
	contentType := stringValue(data.Content["type"])
	if contentType == "" {
		contentType = MessageTypeText
	}
	if contentType != MessageTypeText && contentType != MessageTypeSystem {
		return "", false
	}
	if isTextEditMessage(data, contentType) {
		return "", false
	}

	text := strings.TrimSpace(stringValue(data.Content["message"]))
	if text == "" {
		return "", false
	}

	return text, true
}

func sleepWithContext(ctx context.Context, duration time.Duration) error {
	if duration <= 0 {
		return nil
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func randDuration(min, max time.Duration) time.Duration {
	if max <= min {
		return min
	}
	return min + time.Duration(randInt(0, int(max-min)))
}

func randInt(min, max int) int {
	if max <= min {
		return min
	}
	return min + int(randUint64()%uint64(max-min+1))
}

func randFloat() float64 {
	return float64(randUint64()) / float64(^uint64(0))
}

func randUint64() uint64 {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return uint64(time.Now().UnixNano())
	}
	return binary.LittleEndian.Uint64(buf[:])
}
