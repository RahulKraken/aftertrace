//go:build unix

package main

import "syscall"

// DuckDB already caps threads at 2. Dropping CPU niceness keeps a large
// history import from fighting the menu-bar app for the first minutes.
func lowerPriority() {
	_ = syscall.Setpriority(syscall.PRIO_PROCESS, 0, 10)
}
