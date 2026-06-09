package whatsmeow

import (
	"sync"

	"go.mau.fi/whatsmeow/types"
)

const messageSendSystemLockKey = "system"

type keyedMutexMap struct {
	mu    sync.Mutex
	locks map[string]*keyedMutexEntry
}

type keyedMutexEntry struct {
	mu   sync.Mutex
	refs int
}

func (m *keyedMutexMap) Lock(key string) func() {
	if key == "" {
		key = messageSendSystemLockKey
	}

	m.mu.Lock()
	if m.locks == nil {
		m.locks = make(map[string]*keyedMutexEntry)
	}
	entry := m.locks[key]
	if entry == nil {
		entry = &keyedMutexEntry{}
		m.locks[key] = entry
	}
	entry.refs++
	m.mu.Unlock()

	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()

		m.mu.Lock()
		entry.refs--
		if entry.refs == 0 && m.locks[key] == entry {
			delete(m.locks, key)
		}
		m.mu.Unlock()
	}
}

func messageSendLockKey(to types.JID) string {
	if to.IsEmpty() {
		return messageSendSystemLockKey
	}
	return to.String()
}
