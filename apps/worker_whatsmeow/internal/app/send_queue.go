package app

import (
	"context"
	"errors"
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
		return workerSendSystemQueueKey
	}
	chatID := chatMessageQueueChatID(data)
	if chatID == "" {
		return workerSendSystemQueueKey
	}
	return "chat:" + chatID
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
