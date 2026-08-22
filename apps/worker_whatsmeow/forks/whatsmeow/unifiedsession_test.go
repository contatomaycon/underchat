// Copyright (c) 2026 Underchat
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package whatsmeow

import (
	"context"
	"errors"
	"strconv"
	"testing"
	"time"

	waBinary "go.mau.fi/whatsmeow/binary"
	"go.mau.fi/whatsmeow/socket"
)

func TestUnifiedSessionIDUsesServerTimeAndWeeklyWindow(t *testing.T) {
	now := time.Date(2026, time.August, 5, 0, 0, 0, 123_000_000, time.UTC)
	offset := 37*time.Second + 400*time.Millisecond
	want := (now.Add(offset).Add(unifiedSessionOffset).UnixMilli() %
		unifiedSessionWindow.Milliseconds())

	if got, expected := unifiedSessionIDAt(now, offset), strconv.FormatInt(want, 10); got != expected {
		t.Fatalf("unified session ID = %q, want %q", got, expected)
	}
}

func TestUnifiedSessionIDNormalizesPreEpochTimestamp(t *testing.T) {
	now := time.UnixMilli(-unifiedSessionOffset.Milliseconds() - 1)

	if got := unifiedSessionIDAt(now, 0); got != "604799999" {
		t.Fatalf("unified session ID = %q, want %q", got, "604799999")
	}
}

func TestUnifiedSessionNodeContainsOnlyRotatingIdentifier(t *testing.T) {
	node := unifiedSessionNode("123456")
	if node.Tag != "ib" {
		t.Fatalf("outer tag = %q, want ib", node.Tag)
	}
	typedChildren, ok := node.Content.([]waBinary.Node)
	if !ok || len(typedChildren) != 1 {
		t.Fatalf("unified session content = %#v, want one binary node", node.Content)
	}
	child := typedChildren[0]
	if child.Tag != "unified_session" || child.Attrs["id"] != "123456" {
		t.Fatalf("unified session child = %#v", child)
	}
	if len(child.Attrs) != 1 || child.Content != nil {
		t.Fatalf("unified session child contains unexpected data: %#v", child)
	}
}

func TestUnifiedSessionRequiresCurrentSocket(t *testing.T) {
	client := &Client{}

	err := client.sendUnifiedSession(context.Background(), socketBinding{})
	if !errors.Is(err, ErrNotConnected) {
		t.Fatalf("send unified session error = %v, want %v", err, ErrNotConnected)
	}
}

func TestUnifiedSessionFromGenerationADoesNotUseGenerationB(t *testing.T) {
	socketA := &socket.NoiseSocket{}
	socketB := &socket.NoiseSocket{}
	client := &Client{
		socket:           socketB,
		socketGeneration: 2,
	}

	err := client.sendUnifiedSession(context.Background(), socketBinding{
		socket:     socketA,
		generation: 1,
	})
	if !errors.Is(err, ErrNotConnected) {
		t.Fatalf("stale generation heartbeat error = %v, want %v", err, ErrNotConnected)
	}
}

func TestStaleConnectSuccessDoesNotEmitOrCloseNewGenerationWait(t *testing.T) {
	socketA := &socket.NoiseSocket{}
	socketB := &socket.NoiseSocket{}
	wait := make(chan struct{})
	client := &Client{
		socket:           socketB,
		socketGeneration: 2,
		socketWait:       wait,
	}
	client.paired.Store(true)
	eventCount := 0
	client.eventHandlers = []wrappedEventHandler{{
		fn: func(any) bool {
			eventCount++
			return true
		},
	}}

	staleCtx := contextWithSocketBinding(context.Background(), socketBinding{
		socket:     socketA,
		generation: 1,
	})
	client.handleConnectSuccess(staleCtx, &waBinary.Node{Tag: "success"})

	if client.IsLoggedIn() {
		t.Fatal("stale connect success marked the replacement generation logged in")
	}
	if eventCount != 0 {
		t.Fatalf("stale connect success emitted %d events, want 0", eventCount)
	}
	select {
	case <-wait:
		t.Fatal("stale connect success closed the replacement generation wait channel")
	default:
	}
}

type socketContextTestKey struct{}

func TestContextWithoutSocketBindingPreservesLifecycleAndUnrelatedValues(t *testing.T) {
	socketA := &socket.NoiseSocket{}
	deadlineParent, deadlineCancel := context.WithTimeout(context.WithValue(
		context.Background(),
		socketContextTestKey{},
		"preserved",
	), time.Minute)
	defer deadlineCancel()
	parent, cancel := context.WithCancel(deadlineParent)
	bound := contextWithSocketBinding(parent, socketBinding{
		socket:     socketA,
		generation: 7,
	})

	clean := contextWithoutSocketBinding(bound)
	if _, ok := socketBindingFromContext(clean); ok {
		t.Fatal("replacement transport context retained the retired socket binding")
	}
	if got := clean.Value(socketContextTestKey{}); got != "preserved" {
		t.Fatalf("unrelated context value = %v, want preserved", got)
	}
	parentDeadline, parentHasDeadline := parent.Deadline()
	cleanDeadline, cleanHasDeadline := clean.Deadline()
	if parentHasDeadline != cleanHasDeadline || !cleanDeadline.Equal(parentDeadline) {
		t.Fatalf(
			"clean deadline = (%v, %t), want (%v, %t)",
			cleanDeadline,
			cleanHasDeadline,
			parentDeadline,
			parentHasDeadline,
		)
	}

	cancel()
	select {
	case <-clean.Done():
		if !errors.Is(clean.Err(), context.Canceled) {
			t.Fatalf("clean context error = %v, want %v", clean.Err(), context.Canceled)
		}
	case <-time.After(time.Second):
		t.Fatal("replacement transport context did not preserve cancellation")
	}
}

func TestContextWithoutSocketBindingAllowsReplacementGeneration(t *testing.T) {
	socketA := &socket.NoiseSocket{}
	socketB := &socket.NoiseSocket{}
	stale := contextWithSocketBinding(context.Background(), socketBinding{
		socket:     socketA,
		generation: 3,
	})
	replacement := contextWithSocketBinding(
		contextWithoutSocketBinding(stale),
		socketBinding{socket: socketB, generation: 4},
	)

	binding, ok := socketBindingFromContext(replacement)
	if !ok {
		t.Fatal("replacement socket binding was not available")
	}
	if binding.socket != socketB || binding.generation != 4 {
		t.Fatalf("replacement binding = %#v, want generation 4", binding)
	}
}
