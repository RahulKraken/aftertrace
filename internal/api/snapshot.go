package api

import (
	"sync"
	"time"
)

// snapshot is a single-flight memo of the polled JSON payloads. Concurrent
// window + tray + status checks share one build; ingest invalidates.
type snapshot struct {
	s *Server

	mu      sync.Mutex
	invalid bool
	busy    bool
	ready   bool
	at      time.Time

	overview any
	sessions any
	status   any
	findings any
	glance   any
	cost     map[string]any
}

func newSnapshot(s *Server) *snapshot {
	return &snapshot{s: s, invalid: true}
}

func (c *snapshot) invalidate() {
	c.mu.Lock()
	c.invalid = true
	c.mu.Unlock()
}

func (c *snapshot) Ready() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ready
}

func (c *snapshot) Busy() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.busy
}

func (c *snapshot) get(key string, build func() (any, error)) (any, error) {
	c.mu.Lock()
	fresh := !c.invalid && time.Since(c.at) < 2*time.Second
	var cached any
	switch key {
	case "overview":
		cached = c.overview
	case "sessions":
		cached = c.sessions
	case "status":
		cached = c.status
	case "findings":
		cached = c.findings
	case "glance":
		cached = c.glance
	}
	if fresh && cached != nil {
		c.mu.Unlock()
		return cached, nil
	}
	c.busy = true
	c.mu.Unlock()

	v, err := build()

	c.mu.Lock()
	c.busy = false
	if err == nil {
		c.invalid = false
		c.ready = true
		c.at = time.Now()
		switch key {
		case "overview":
			c.overview = v
		case "sessions":
			c.sessions = v
		case "status":
			c.status = v
		case "findings":
			c.findings = v
		case "glance":
			c.glance = v
		}
	}
	c.mu.Unlock()
	return v, err
}

func (c *snapshot) costDim(dim string, build func() (any, error)) (any, error) {
	c.mu.Lock()
	if !c.invalid && time.Since(c.at) < 2*time.Second && c.cost != nil {
		if v, ok := c.cost[dim]; ok {
			c.mu.Unlock()
			return v, nil
		}
	}
	c.mu.Unlock()
	v, err := build()
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if c.cost == nil {
		c.cost = map[string]any{}
	}
	c.cost[dim] = v
	c.mu.Unlock()
	return v, nil
}
