package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/RahulKraken/aftertrace/internal/harness"
)

const devUsage = `usage: aftertrace dev gen-history --size 2GiB --sessions 3000 --seed 42 [--dir DIR]

Hidden test commands. gen-history writes a deterministic Claude Code
~/.claude/projects tree for the scale harness.`

func cmdDev(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, devUsage)
		return 2
	}
	switch args[0] {
	case "gen-history":
		return cmdGenHistory(args[1:])
	case "help", "-h", "--help":
		fmt.Println(devUsage)
		return 0
	default:
		fmt.Fprintf(os.Stderr, "unknown dev command %q\n%s\n", args[0], devUsage)
		return 2
	}
}

func cmdGenHistory(args []string) int {
	fs := flag.NewFlagSet("dev gen-history", flag.ExitOnError)
	sizeStr := fs.String("size", "2GiB", "target tree size (GiB, MiB, GB, MB, or bytes)")
	sessions := fs.Int("sessions", 3000, "number of session JSONL files")
	seed := fs.Int64("seed", 42, "RNG seed")
	dir := fs.String("dir", "", "output projects directory (required)")
	_ = fs.Parse(args)
	if *dir == "" {
		fmt.Fprintln(os.Stderr, "dev gen-history: --dir is required")
		fmt.Fprintln(os.Stderr, devUsage)
		return 2
	}
	size, err := harness.ParseSize(*sizeStr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "dev gen-history: %v\n", err)
		return 2
	}
	if *sessions < 1 {
		fmt.Fprintln(os.Stderr, "dev gen-history: --sessions must be >= 1")
		return 2
	}
	res, err := harness.GenerateHistory(*dir, harness.GenOpts{
		Size:     size,
		Sessions: *sessions,
		Seed:     *seed,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "dev gen-history: %v\n", err)
		return 1
	}
	fmt.Printf("wrote %d sessions (%d files, %d projects, %d bytes) to %s\n",
		res.Sessions, res.Files, res.Projects, res.Bytes, res.Dir)
	return 0
}
