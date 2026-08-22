// Copyright (c) 2025 Tulir Asokan
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package socket

import (
	"context"
	"crypto/cipher"
	"encoding/binary"
	"sync"
	"sync/atomic"

	"github.com/coder/websocket"
)

type NoiseSocket struct {
	fs           *FrameSocket
	onFrame      SourceFrameHandler
	writeKey     cipher.AEAD
	readKey      cipher.AEAD
	writeCounter uint32
	readCounter  uint32
	writeLock    sync.Mutex
	started      atomic.Bool
	destroyed    atomic.Bool
	stopConsumer chan struct{}
}

type DisconnectHandler func(ctx context.Context, socket *NoiseSocket, remote bool)

// FrameHandler is the compatibility callback used by NoiseHandshake.Finish.
type FrameHandler func(context.Context, []byte)

// SourceFrameHandler receives the exact NoiseSocket that decrypted the frame. The
// source socket must travel with the frame because a client may already have
// installed a replacement transport by the time an asynchronous node handler
// runs.
type SourceFrameHandler func(context.Context, *NoiseSocket, []byte)

func newNoiseSocket(
	ctx context.Context,
	fs *FrameSocket,
	writeKey, readKey cipher.AEAD,
	frameHandler SourceFrameHandler,
	disconnectHandler DisconnectHandler,
) (*NoiseSocket, error) {
	ns := &NoiseSocket{
		fs:           fs,
		writeKey:     writeKey,
		readKey:      readKey,
		onFrame:      frameHandler,
		stopConsumer: make(chan struct{}),
	}
	fs.OnDisconnect = func(ctx context.Context, remote bool) {
		disconnectHandler(ctx, ns, remote)
	}
	return ns, nil
}

// Start activates frame consumption after the owner has installed this socket
// as its current generation. Splitting construction from activation closes the
// small race where the first decrypted node could be handled before the client
// knew which NoiseSocket produced it.
func (ns *NoiseSocket) Start(ctx context.Context) {
	if ns != nil && ns.started.CompareAndSwap(false, true) {
		go ns.consumeFrames(ctx, ns.fs.Frames)
	}
}

func (ns *NoiseSocket) consumeFrames(ctx context.Context, frames <-chan []byte) {
	if ctx == nil {
		// ctx being nil implies the connection already closed somehow
		return
	}
	ctxDone := ctx.Done()
	for {
		select {
		case frame := <-frames:
			ns.receiveEncryptedFrame(ctx, frame)
		case <-ctxDone:
			return
		case <-ns.stopConsumer:
			return
		}
	}
}

func generateIV(count uint32) []byte {
	iv := make([]byte, 12)
	binary.BigEndian.PutUint32(iv[8:], count)
	return iv
}

func (ns *NoiseSocket) Stop(disconnect, allowOnDisconnect bool) {
	if ns.destroyed.CompareAndSwap(false, true) {
		close(ns.stopConsumer)
		if !allowOnDisconnect {
			ns.fs.OnDisconnect = nil
		}
		if disconnect {
			ns.fs.Close(websocket.StatusNormalClosure)
		}
	}
}

func (ns *NoiseSocket) SendFrame(ctx context.Context, plaintext []byte) error {
	ns.writeLock.Lock()
	defer ns.writeLock.Unlock()
	if ns.destroyed.Load() {
		return ErrSocketClosed
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	// Don't reuse plaintext slice for storage as it may be needed for retries
	ciphertext := ns.writeKey.Seal(nil, generateIV(ns.writeCounter), plaintext, nil)
	ns.writeCounter++
	doneChan := make(chan error, 1)
	go func() {
		doneChan <- ns.fs.SendFrame(ciphertext)
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case retErr := <-doneChan:
		return retErr
	}
}

func (ns *NoiseSocket) receiveEncryptedFrame(ctx context.Context, ciphertext []byte) {
	plaintext, err := ns.readKey.Open(ciphertext[:0], generateIV(ns.readCounter), ciphertext, nil)
	ns.readCounter++
	if err != nil {
		ns.fs.log.Warnf("Failed to decrypt frame: %v", err)
		return
	}
	ns.onFrame(ctx, ns, plaintext)
}

func (ns *NoiseSocket) IsConnected() bool {
	return ns.fs.IsConnected()
}
