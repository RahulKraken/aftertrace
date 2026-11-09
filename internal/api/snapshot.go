package api

import (
	"sync"
	"time"
)

const snapshotTTL = 4 * time.Second

type inflight struct {
	wg  sync.WaitGroup
	v   any
	err error
}

// snapshot is a single-flight memo of the polled JSON payloads. Concurrent
// window + tray + status checks share one build; ingest invalidates.
type snapshot struct {
	s *Server

	mu       sync.Mutex
	invalid  bool
	busy     bool
	ready    bool
	at       time.Time
	inflight map[string]*inflight

	overview any
	sessions any
	status   any
	findings any
	glance   any
	cost     map[string]any
}

func newSnapshot(s *Server) *snapshot {
	return &snapshot{s: s, invalid: true, inflight: map[string]*inflight{}}
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

func (c *snapshot) cached(key string) any {
	switch key {
	case "overview":
		return c.overview
	case "sessions":
		return c.sessions
	case "status":
		return c.status
	case "findings":
		return c.findings
	case "glance":
		return c.glance
	}
	return nil
}

func (c *snapshot) get(key string, build func() (any, error)) (any, error) {
	c.mu.Lock()
	fresh := !c.invalid && time.Since(c.at) < snapshotTTL
	if v := c.cached(key); fresh && v != nil {
		c.mu.Unlock()
		return v, nil
	}
	if inf := c.inflight[key]; inf != nil {
		c.mu.Unlock()
		inf.wg.Wait()
		return inf.v, inf.err
	}
	inf := &inflight{}
	inf.wg.Add(1)
	c.inflight[key] = inf
	c.busy = true
	c.mu.Unlock()

	inf.v, inf.err = build()

	c.mu.Lock()
	delete(c.inflight, key)
	c.busy = len(c.inflight) > 0
	if inf.err == nil {
		c.invalid = false
		c.ready = true
		c.at = time.Now()
		switch key {
		case "overview":
			c.overview = inf.v
		case "sessions":
			c.sessions = inf.v
		case "status":
			c.status = inf.v
		case "findings":
			c.findings = inf.v
		case "glance":
			c.glance = inf.v
		}
	}
	c.mu.Unlock()
	inf.wg.Done()
	return inf.v, inf.err
}

func (c *snapshot) costDim(dim string, build func() (any, error)) (any, error) {
	key := "cost:" + dim
	c.mu.Lock()
	if !c.invalid && time.Since(c.at) < snapshotTTL && c.cost != nil {
		if v, ok := c.cost[dim]; ok {
			c.mu.Unlock()
			return v, nil
		}
	}
	if inf := c.inflight[key]; inf != nil {
		c.mu.Unlock()
		inf.wg.Wait()
		return inf.v, inf.err
	}
	inf := &inflight{}
	inf.wg.Add(1)
	c.inflight[key] = inf
	c.mu.Unlock()
	inf.v, inf.err = build()
	c.mu.Lock()
	delete(c.inflight, key)
	if inf.err == nil {
		if c.cost == nil {
			c.cost = map[string]any{}
		}
		c.cost[dim] = inf.v
	}
	c.mu.Unlock()
	inf.wg.Done()
	return inf.v, inf.err
}
