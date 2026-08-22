// Copyright (c) 2025 Tulir Asokan
//
// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

package socket

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"

	"github.com/coder/websocket"

	waLog "go.mau.fi/whatsmeow/util/log"
)

type FrameSocket struct {
	parentCtx context.Context
	cancelCtx context.Context
	cancel    context.CancelFunc
	conn      atomic.Pointer[websocket.Conn]
	log       waLog.Logger
	lock      sync.Mutex

	URL         string
	HTTPHeaders http.Header
	HTTPClient  *http.Client

	Frames       chan []byte
	OnDisconnect func(ctx context.Context, remote bool)

	Header []byte
	// WireHeader overrides Header only for the first frame written on the
	// transport. Header remains the Noise prologue, so edge-routing metadata
	// never changes the authenticated Noise transcript.
	WireHeader []byte

	closed atomic.Bool

	incomingLength int
	receivedLength int
	incoming       []byte
	partialHeader  []byte
}

func NewFrameSocket(log waLog.Logger, client *http.Client) *FrameSocket {
	return &FrameSocket{
		log:    log,
		Header: WAConnHeader,
		Frames: make(chan []byte),

		URL:         URL,
		HTTPHeaders: http.Header{"Origin": {Origin}},
		HTTPClient:  client,
	}
}

func (fs *FrameSocket) IsConnected() bool {
	return fs.conn.Load() != nil
}

func (fs *FrameSocket) Close(code websocket.StatusCode) {
	fs.lock.Lock()
	defer fs.lock.Unlock()

	conn := fs.conn.Swap(nil)
	if conn == nil {
		return
	}

	fs.closed.Store(true)
	if code > 0 {
		err := conn.Close(code, "")
		if err != nil {
			fs.log.Warnf("Error sending close to websocket: %v", err)
		}
	} else {
		err := conn.CloseNow()
		if err != nil {
			fs.log.Debugf("Error force closing websocket: %v", err)
		}
	}
	fs.cancel()
	fs.cancel = nil
	if fs.OnDisconnect != nil {
		go fs.OnDisconnect(fs.parentCtx, code == 0)
	}
}

func (fs *FrameSocket) Connect(ctx context.Context) error {
	fs.lock.Lock()
	defer fs.lock.Unlock()
	if fs.conn.Load() != nil {
		return ErrSocketAlreadyOpen
	}
	fs.parentCtx = ctx
	fs.cancelCtx, fs.cancel = context.WithCancel(ctx)

	fs.log.Debugf("Dialing %s", safeDialURL(fs.URL))
	conn, resp, err := websocket.Dial(ctx, fs.URL, fs.makeDialOptions())
	if err != nil {
		if resp != nil {
			err = ErrWithStatusCode{err, resp.StatusCode}
		}
		fs.cancel()
		return fmt.Errorf("%w: %w", ErrDialFailed, err)
	}
	conn.SetReadLimit(FrameMaxSize)

	fs.conn.Store(conn)

	go fs.readPump(conn, ctx)
	return nil
}

func (fs *FrameSocket) Context() context.Context {
	return fs.cancelCtx
}

func (fs *FrameSocket) SendFrame(data []byte) error {
	conn := fs.conn.Load()
	if conn == nil {
		return ErrSocketClosed
	}
	dataLength := len(data)
	if dataLength >= FrameMaxSize {
		return fmt.Errorf("%w (got %d bytes, max %d bytes)", ErrFrameTooLarge, len(data), FrameMaxSize)
	}

	wireHeader := fs.Header
	if fs.WireHeader != nil {
		wireHeader = fs.WireHeader
	}
	headerLength := len(wireHeader)
	// Whole frame is header + 3 bytes for length + data
	wholeFrame := make([]byte, headerLength+FrameLengthSize+dataLength)

	// Copy the header if it's there
	if wireHeader != nil {
		copy(wholeFrame[:headerLength], wireHeader)
		// We only want to send the header once
		fs.Header = nil
		fs.WireHeader = nil
	}

	// Encode length of frame
	wholeFrame[headerLength] = byte(dataLength >> 16)
	wholeFrame[headerLength+1] = byte(dataLength >> 8)
	wholeFrame[headerLength+2] = byte(dataLength)

	// Copy actual frame data
	copy(wholeFrame[headerLength+FrameLengthSize:], data)

	return conn.Write(fs.cancelCtx, websocket.MessageBinary, wholeFrame)
}

// BuildRoutingIntroHeader creates WhatsApp's one-shot edge-routing transport
// prefix. WAConnHeader remains at the end of the wire intro and separately as
// the Noise prologue.
func BuildRoutingIntroHeader(routingInfo []byte) ([]byte, error) {
	if len(routingInfo) == 0 || len(routingInfo) > 65535 {
		return nil, errors.New("invalid edge routing info length")
	}
	header := make([]byte, 7+len(routingInfo)+len(WAConnHeader))
	header[0], header[1] = 'E', 'D'
	header[2], header[3] = 0, 1
	header[4] = byte(len(routingInfo) >> 16)
	header[5] = byte(len(routingInfo) >> 8)
	header[6] = byte(len(routingInfo))
	copy(header[7:], routingInfo)
	copy(header[7+len(routingInfo):], WAConnHeader)
	return header, nil
}

// URLWithRoutingInfo attaches the same opaque route as unpadded base64url.
func URLWithRoutingInfo(rawURL string, routingInfo []byte) (string, error) {
	if len(routingInfo) == 0 || len(routingInfo) > 65535 {
		return "", errors.New("invalid edge routing info length")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	} else if parsed.Scheme != "wss" {
		return "", errors.New("edge routing requires a secure websocket URL")
	}
	query := parsed.Query()
	query.Set("ED", base64.RawURLEncoding.EncodeToString(routingInfo))
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func safeDialURL(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "<invalid websocket URL>"
	}
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.Redacted()
}

func (fs *FrameSocket) frameComplete() {
	data := fs.incoming
	fs.incoming = nil
	fs.partialHeader = nil
	fs.incomingLength = 0
	fs.receivedLength = 0
	fs.Frames <- data
}

func (fs *FrameSocket) processData(msg []byte) {
	for len(msg) > 0 {
		// This probably doesn't happen a lot (if at all), so the code is unoptimized
		if fs.partialHeader != nil {
			msg = append(fs.partialHeader, msg...)
			fs.partialHeader = nil
		}
		if fs.incoming == nil {
			if len(msg) >= FrameLengthSize {
				length := (int(msg[0]) << 16) + (int(msg[1]) << 8) + int(msg[2])
				fs.incomingLength = length
				fs.receivedLength = len(msg)
				msg = msg[FrameLengthSize:]
				if len(msg) >= length {
					fs.incoming = msg[:length]
					msg = msg[length:]
					fs.frameComplete()
				} else {
					fs.incoming = make([]byte, length)
					copy(fs.incoming, msg)
					msg = nil
				}
			} else {
				fs.log.Warnf("Received partial header (report if this happens often)")
				fs.partialHeader = msg
				msg = nil
			}
		} else {
			if fs.receivedLength+len(msg) >= fs.incomingLength {
				copy(fs.incoming[fs.receivedLength:], msg[:fs.incomingLength-fs.receivedLength])
				msg = msg[fs.incomingLength-fs.receivedLength:]
				fs.frameComplete()
			} else {
				copy(fs.incoming[fs.receivedLength:], msg)
				fs.receivedLength += len(msg)
				msg = nil
			}
		}
	}
}

func (fs *FrameSocket) readPump(conn *websocket.Conn, ctx context.Context) {
	fs.log.Debugf("Frame websocket read pump starting %p", fs)
	defer func() {
		fs.log.Debugf("Frame websocket read pump exiting %p", fs)
		go fs.Close(0)
	}()
	for {
		msgType, data, err := conn.Read(ctx)
		if err != nil {
			// Ignore the error if the context has been closed
			if !fs.closed.Load() && !errors.Is(ctx.Err(), context.Canceled) {
				fs.log.Errorf("Error reading from websocket: %v", err)
			}
			return
		} else if msgType != websocket.MessageBinary {
			fs.log.Warnf("Got unexpected websocket message type %d", msgType)
			continue
		}
		fs.processData(data)
	}
}
