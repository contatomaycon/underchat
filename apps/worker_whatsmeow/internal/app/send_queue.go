package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/segmentio/kafka-go"
)

const workerSendSystemQueueKey = "system"

type keyedSequencer struct {
	mu     sync.Mutex
	chains map[string]chan struct{}
}

func newKeyedSequencer() *keyedSequencer {
	return &keyedSequencer{
		chains: make(map[string]chan struct{}),
	}
}

func (s *keyedSequencer) enqueue(chainCtx, taskParentCtx context.Context, key string, timeout time.Duration, task func(context.Context) error) <-chan error {
	if strings.TrimSpace(key) == "" {
		key = workerSendSystemQueueKey
	}
	done := make(chan error, 1)
	current := make(chan struct{})

	s.mu.Lock()
	previous := s.chains[key]
	s.chains[key] = current
	s.mu.Unlock()

	go func() {
		defer close(current)
		defer s.cleanup(key, current)

		if previous != nil {
			select {
			case <-previous:
			case <-chainCtx.Done():
				done <- chainCtx.Err()
				return
			}
		}
		select {
		case <-chainCtx.Done():
			done <- chainCtx.Err()
			return
		default:
		}

		taskCtx, cancel := sequencerTaskContext(taskParentCtx, timeout)
		defer cancel()

		errCh := make(chan error, 1)
		go func() {
			errCh <- task(taskCtx)
		}()

		select {
		case err := <-errCh:
			done <- err
		case <-taskCtx.Done():
			done <- taskCtx.Err()
		}
	}()

	return done
}

func sequencerTaskContext(parent context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return context.WithCancel(parent)
	}
	return context.WithTimeout(parent, timeout)
}

func runKafkaQueueTask(parent context.Context, timeout time.Duration, task func(context.Context) error) <-chan error {
	done := make(chan error, 1)
	go func() {
		taskCtx, cancel := sequencerTaskContext(parent, timeout)
		defer cancel()

		errCh := make(chan error, 1)
		go func() {
			errCh <- task(taskCtx)
		}()

		select {
		case err := <-errCh:
			done <- err
		case <-taskCtx.Done():
			done <- taskCtx.Err()
		}
	}()
	return done
}

func (s *keyedSequencer) cleanup(key string, current chan struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.chains[key] == current {
		delete(s.chains, key)
	}
}

type partitionCommitCoordinator struct {
	mu       sync.Mutex
	states   map[int]*partitionCommitState
	commitFn func(context.Context, kafka.Message) error
}

type partitionCommitState struct {
	nextOffset int64
	hasNext    bool
	pending    map[int64]struct{}
	completed  map[int64]kafka.Message
}

func newPartitionCommitCoordinator(commitFn func(context.Context, kafka.Message) error) *partitionCommitCoordinator {
	return &partitionCommitCoordinator{
		states:   make(map[int]*partitionCommitState),
		commitFn: commitFn,
	}
}

func (c *partitionCommitCoordinator) register(msg kafka.Message) {
	c.mu.Lock()
	defer c.mu.Unlock()

	state := c.stateForPartition(msg.Partition)
	state.pending[msg.Offset] = struct{}{}
	if !state.hasNext || msg.Offset < state.nextOffset {
		state.nextOffset = msg.Offset
		state.hasNext = true
	}
}

func (c *partitionCommitCoordinator) complete(ctx context.Context, msg kafka.Message) (bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	state := c.states[msg.Partition]
	if state == nil {
		return false, nil
	}
	if _, ok := state.pending[msg.Offset]; !ok {
		return false, nil
	}
	state.completed[msg.Offset] = msg
	return c.flushLocked(ctx, msg.Partition, state)
}

func (c *partitionCommitCoordinator) stateForPartition(partition int) *partitionCommitState {
	state := c.states[partition]
	if state != nil {
		return state
	}
	state = &partitionCommitState{
		pending:   make(map[int64]struct{}),
		completed: make(map[int64]kafka.Message),
	}
	c.states[partition] = state
	return state
}

func (c *partitionCommitCoordinator) flushLocked(ctx context.Context, partition int, state *partitionCommitState) (bool, error) {
	if !state.hasNext {
		return false, nil
	}

	start := state.nextOffset
	end := start
	var commitMsg kafka.Message
	for {
		msg, ok := state.completed[end]
		if !ok {
			break
		}
		commitMsg = msg
		end++
	}
	commitUpTo := end - 1
	if commitUpTo < start {
		return false, nil
	}
	if c.commitFn == nil {
		return false, errors.New("partition commit function is not configured")
	}
	if err := c.commitFn(ctx, commitMsg); err != nil {
		return false, err
	}

	for offset := start; offset <= commitUpTo; offset++ {
		delete(state.pending, offset)
		delete(state.completed, offset)
	}
	if len(state.pending) == 0 && len(state.completed) == 0 {
		delete(c.states, partition)
		return true, nil
	}
	state.nextOffset = commitUpTo + 1
	state.hasNext = true
	return true, nil
}

func workerSendQueueKey(raw []byte) string {
	data, err := mapToChatMessage(raw)
	if err != nil || strings.TrimSpace(data.MessageID) == "" {
		return workerSendNonChatQueueKey(raw)
	}
	chatID := chatMessageQueueChatID(data)
	if chatID == "" {
		return workerSendSystemQueueKey
	}
	accountID := firstNonEmpty(stringValue(data.Account["id"]), "unknown-account")
	return "chat:" + accountID + ":" + chatID
}

func kafkaMessageQueueKey(topic string, msg kafka.Message) string {
	if !kafkaTopicRequiresMessageOrder(topic) {
		return fmt.Sprintf("offset:%s:%d:%d", topic, msg.Partition, msg.Offset)
	}

	switch {
	case isWorkerSendTopic(topic):
		if queueKey := workerSendQueueKey(msg.Value); queueKey != workerSendSystemQueueKey {
			return queueKey
		}
	case strings.Contains(topic, ".schedule.send.message"):
		if queueKey := scheduleMessageQueueKey(topic, msg.Value); queueKey != workerSendSystemQueueKey {
			return queueKey
		}
	case strings.Contains(topic, ".notification.message"):
		if queueKey := notificationQueueKey(msg.Value); queueKey != workerSendSystemQueueKey {
			return queueKey
		}
	}

	if kafkaKey := strings.TrimSpace(string(msg.Key)); kafkaKey != "" {
		return "kafka:" + kafkaKey
	}

	return fmt.Sprintf("offset:%s:%d:%d", topic, msg.Partition, msg.Offset)
}

func kafkaTopicRequiresMessageOrder(topic string) bool {
	return isWorkerSendTopic(topic) ||
		strings.Contains(topic, ".schedule.send.message") ||
		strings.Contains(topic, ".notification.message")
}

func workerSendNonChatQueueKey(raw []byte) string {
	var fields map[string]any
	_ = json.Unmarshal(raw, &fields)

	var profileStatusDelete ProfileStatusDeleteMessage
	if err := json.Unmarshal(raw, &profileStatusDelete); err == nil && hasAnyJSONField(fields, "external_id") {
		if id := firstNonEmpty(profileStatusDelete.ExternalID, profileStatusDelete.WorkerProfileStatusID); id != "" {
			return "profile_status_delete:" + id
		}
	}

	var profileInfo ProfileInfoMessage
	if err := json.Unmarshal(raw, &profileInfo); err == nil && hasAnyJSONField(fields, "name", "message", "photo") {
		workerID := strings.TrimSpace(profileInfo.WorkerID)
		accountID := strings.TrimSpace(profileInfo.AccountID)
		if workerID != "" && accountID != "" {
			return "profile_info:" + workerID + ":" + accountID
		}
		if id := firstNonEmpty(workerID, accountID); id != "" {
			return "profile_info:" + id
		}
	}

	var profileStatus ProfileStatusMessage
	if err := json.Unmarshal(raw, &profileStatus); err == nil && hasAnyJSONField(fields, "worker_profile_status_id", "worker_profile_status_type_id", "value", "statusJidList") {
		if id := firstNonEmpty(profileStatus.WorkerProfileStatusID, profileStatus.WorkerID); id != "" {
			return "profile_status:" + id
		}
	}

	return workerSendSystemQueueKey
}

func hasAnyJSONField(fields map[string]any, keys ...string) bool {
	if len(fields) == 0 {
		return false
	}
	for _, key := range keys {
		if _, ok := fields[key]; ok {
			return true
		}
	}
	return false
}

func scheduleMessageQueueKey(topic string, raw []byte) string {
	var data ScheduleMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return workerSendSystemQueueKey
	}

	accountID := firstNonEmpty(stringValue(data.Message.Account["id"]), data.AccountID, "unknown-account")
	workerID := firstNonEmpty(workerIDFromTopic(topic), stringValue(data.Message.Worker["id"]), "unknown-channel")
	return "account:" + accountID + ":channel:" + workerID
}

func workerIDFromTopic(topic string) string {
	parts := strings.Split(topic, ".")
	if len(parts) >= 2 && parts[0] == "worker" {
		return strings.TrimSpace(parts[1])
	}
	return ""
}

func phoneValidationQueueKey(raw []byte) string {
	var data PhoneValidationRequest
	if err := json.Unmarshal(raw, &data); err != nil {
		return workerSendSystemQueueKey
	}
	return firstNonEmpty(
		"phone_validation:"+data.RequestID,
		"phone_validation:"+data.AccountID+":"+data.PhoneDDI+":"+data.Phone,
		workerSendSystemQueueKey,
	)
}

func notificationQueueKey(raw []byte) string {
	var data NotificationMessage
	if err := json.Unmarshal(raw, &data); err != nil {
		return workerSendSystemQueueKey
	}
	destination := ""
	if remoteJID := strings.TrimSpace(data.MessageKey.RemoteJID); remoteJID != "" {
		destination = "jid:" + remoteJID
	} else if phoneDDI := strings.TrimSpace(data.MessageKey.PhoneDDI); phoneDDI != "" {
		if phoneNumber := strings.TrimSpace(data.MessageKey.PhoneNumber); phoneNumber != "" {
			destination = "phone:" + phoneDDI + ":" + phoneNumber
		}
	}
	if destination == "" {
		return workerSendSystemQueueKey
	}
	accountID := firstNonEmpty(stringValue(data.Account["id"]), "unknown-account")
	return "chat:" + accountID + ":" + destination
}

func webhookQueueKey(raw []byte) string {
	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return workerSendSystemQueueKey
	}
	return firstNonEmpty(
		"webhook:"+stringValue(data["account_id"])+":"+stringValue(data["worker_id"])+":"+stringValue(data["phone_ddi"])+":"+stringValue(data["phone"]),
		workerSendSystemQueueKey,
	)
}

func markReadQueueKey(raw []byte) string {
	var data MarkReadRequest
	if err := json.Unmarshal(raw, &data); err != nil {
		return workerSendSystemQueueKey
	}
	jids := make([]string, 0, len(data.Keys))
	for _, key := range data.Keys {
		if remote := strings.TrimSpace(key.Remote()); remote != "" {
			jids = append(jids, remote)
		}
	}
	if len(jids) == 0 {
		return firstNonEmpty("mark_read:"+data.AccountID+":"+data.WorkerID, workerSendSystemQueueKey)
	}
	return "mark_read:" + data.AccountID + ":" + data.WorkerID + ":" + strings.Join(jids, ",")
}

func workerConfigQueueKey(raw []byte) string {
	var data WorkerConfigUpdateEvent
	if err := json.Unmarshal(raw, &data); err != nil {
		return workerSendSystemQueueKey
	}
	return firstNonEmpty("worker_config:"+data.WorkerID, workerSendSystemQueueKey)
}

func chatMessageQueueChatID(data ChatMessage) string {
	if chatID := strings.TrimSpace(data.ChatID); chatID != "" {
		return chatID
	}
	if data.MessageKey != nil {
		if remote := strings.TrimSpace(data.MessageKey.Remote()); remote != "" {
			return remote
		}
	}
	return strings.TrimSpace(data.Phone)
}
