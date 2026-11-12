package harness

import (
	"os"
	"strconv"
	"time"
)

// Profile names: ci (GitHub macos-14 ~15m), nightly (10m idle), full (2GiB).
type Profile struct {
	Name        string
	Size        int64
	Sessions    int
	Seed        int64
	Idle        time.Duration
	Load        time.Duration
	CrashTrials int
	OTLPBatches int
	OTLPRate    int
	OTLPCopies  int
	RSSEvery    time.Duration
	SpillEvery  time.Duration
	IdleEvery   time.Duration
}

func ProfileFromEnv() Profile {
	name := os.Getenv("AFTERTRACE_HARNESS_PROFILE")
	if name == "" {
		name = "ci"
	}
	p := profileNamed(name)
	if s := os.Getenv("AFTERTRACE_HARNESS_SIZE"); s != "" {
		if n, err := ParseSize(s); err == nil {
			p.Size = n
		}
	}
	if s := os.Getenv("AFTERTRACE_HARNESS_SESSIONS"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			p.Sessions = n
		}
	}
	if s := os.Getenv("AFTERTRACE_HARNESS_IDLE"); s != "" {
		if d, err := time.ParseDuration(s); err == nil {
			p.Idle = d
		}
	}
	if s := os.Getenv("AFTERTRACE_HARNESS_CRASH"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 0 {
			p.CrashTrials = n
		}
	}
	if s := os.Getenv("AFTERTRACE_HARNESS_LOAD"); s != "" {
		if d, err := time.ParseDuration(s); err == nil {
			p.Load = d
		}
	}
	return p
}

func profileNamed(name string) Profile {
	switch name {
	case "full":
		return Profile{
			Name: "full", Size: 2 << 30, Sessions: 3000, Seed: 42,
			Idle: 10 * time.Minute, Load: 60 * time.Second, CrashTrials: 10,
			OTLPBatches: 40, OTLPRate: 50, OTLPCopies: 3,
			RSSEvery: 200 * time.Millisecond, SpillEvery: 500 * time.Millisecond, IdleEvery: time.Second,
		}
	case "nightly":
		return Profile{
			Name: "nightly", Size: 32 << 20, Sessions: 80, Seed: 42,
			Idle: 10 * time.Minute, Load: 60 * time.Second, CrashTrials: 10,
			OTLPBatches: 20, OTLPRate: 50, OTLPCopies: 3,
			RSSEvery: 200 * time.Millisecond, SpillEvery: 500 * time.Millisecond, IdleEvery: time.Second,
		}
	default:
		return Profile{
			Name: "ci", Size: 32 << 20, Sessions: 80, Seed: 42,
			Idle: 20 * time.Second, Load: 60 * time.Second, CrashTrials: 10,
			OTLPBatches: 20, OTLPRate: 50, OTLPCopies: 3,
			RSSEvery: 200 * time.Millisecond, SpillEvery: 500 * time.Millisecond, IdleEvery: time.Second,
		}
	}
}

func (p Profile) CorpusNote() string {
	return FormatSize(p.Size) + ", " + strconv.Itoa(p.Sessions) + " sessions, seed " + strconv.FormatInt(p.Seed, 10)
}
