//go:build harness

package store

import (
	"fmt"
	"os"
)

func logHarnessRecycle(path string) {
	fmt.Fprintf(os.Stderr, "harness: store recycle path=%s\n", path)
}
