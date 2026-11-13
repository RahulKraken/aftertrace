//go:build !harness

package main

import "github.com/RahulKraken/aftertrace/internal/store"

func watchHarnessReopen(_ *store.Store, _ <-chan struct{}) {}
