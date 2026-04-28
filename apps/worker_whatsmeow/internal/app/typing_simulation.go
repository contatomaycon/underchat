package app

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
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
	typingSimulationDefaultSpeed = 50
	typingSimulationTTL          = 7 * 24 * time.Hour
)

var typingSimulationPunctuationPattern = regexp.MustCompile(`[.,!?;:]`)

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
	if m.balance == nil {
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
			log.Printf("whatsmeow typing simulation redis get failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		}
	}

	config, err := m.balance.GetTypingSimulationConfig(ctx, m.cfg.WorkerID, m.cfg.AccountID)
	if err != nil {
		log.Printf("whatsmeow typing simulation grpc fetch failed worker_id=%s error=%v", m.cfg.WorkerID, err)
		return defaultConfig
	}

	config = normalizeTypingSimulationConfig(config)
	if m.redis != nil {
		if payload, err := json.Marshal(config); err == nil {
			if err := m.redis.Set(ctx, cacheKey, string(payload), typingSimulationTTL).Err(); err != nil {
				log.Printf("whatsmeow typing simulation redis set failed worker_id=%s error=%v", m.cfg.WorkerID, err)
			}
		}
	}

	return config
}

func (m *WhatsAppManager) simulateTypingBeforeSend(ctx context.Context, client *whatsmeow.Client, target types.JID, text string) {
	config := m.getTypingSimulationConfig(ctx)
	if !config.Enabled {
		return
	}

	if err := simulateHumanTyping(ctx, client, target, text, config.Speed); err != nil {
		log.Printf("whatsmeow typing simulation skipped worker_id=%s jid=%s error=%v", m.cfg.WorkerID, target.String(), err)
	}
}

func simulateHumanTyping(ctx context.Context, client *whatsmeow.Client, target types.JID, text string, speed int) error {
	duration := time.Duration(float64(estimateTypingDuration(text)) * typingSimulationDelayMultiplier(speed))

	if err := sleepWithContext(ctx, randDuration(100*time.Millisecond, 450*time.Millisecond)); err != nil {
		return err
	}

	if err := client.SendChatPresence(ctx, target, types.ChatPresenceComposing, types.ChatPresenceMediaText); err != nil {
		return err
	}

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
			_ = client.SendChatPresence(ctx, target, types.ChatPresencePaused, types.ChatPresenceMediaText)
			if err := sleepWithContext(ctx, randDuration(250*time.Millisecond, 750*time.Millisecond)); err != nil {
				return err
			}
		}

		if err := client.SendChatPresence(ctx, target, types.ChatPresenceComposing, types.ChatPresenceMediaText); err != nil {
			return err
		}
	}

	if err := sleepWithContext(ctx, randDuration(75*time.Millisecond, 250*time.Millisecond)); err != nil {
		return err
	}

	return client.SendChatPresence(ctx, target, types.ChatPresencePaused, types.ChatPresenceMediaText)
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
