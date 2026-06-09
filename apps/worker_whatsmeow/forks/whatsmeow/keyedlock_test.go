package whatsmeow

import (
	"testing"
	"time"
)

func TestKeyedMutexMapSerializesSameKey(t *testing.T) {
	var locks keyedMutexMap
	unlockFirst := locks.Lock("chat:a")
	secondAcquired := make(chan struct{})

	go func() {
		unlockSecond := locks.Lock("chat:a")
		close(secondAcquired)
		unlockSecond()
	}()

	select {
	case <-secondAcquired:
		t.Fatal("expected same key to wait for the first lock")
	case <-time.After(20 * time.Millisecond):
	}

	unlockFirst()

	select {
	case <-secondAcquired:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("expected same key to acquire after unlock")
	}
}

func TestKeyedMutexMapAllowsDifferentKeysInParallel(t *testing.T) {
	var locks keyedMutexMap
	unlockFirst := locks.Lock("chat:a")
	secondAcquired := make(chan struct{})

	go func() {
		unlockSecond := locks.Lock("chat:b")
		close(secondAcquired)
		unlockSecond()
	}()

	select {
	case <-secondAcquired:
	case <-time.After(200 * time.Millisecond):
		unlockFirst()
		t.Fatal("expected different key to acquire without waiting")
	}

	unlockFirst()
}
