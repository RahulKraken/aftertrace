// Facts only this figure states, read from the receiver's source so the
// drawing and its readouts can never drift from what the code does.
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const read = (p) => readFileSync(join(ROOT, p), "utf8")

const server = read("internal/otlp/server.go")
const convert = read("internal/otlp/convert.go")
const jsonl = read("internal/otlp/jsonl.go")
const main = read("cmd/aftertrace/main.go")

function must(m, what) {
  if (!m) throw new Error(`receive facts: ${what} not found`)
  return m
}

// const maxBody = 32 << 20
const shift = must(server.match(/const maxBody = (\d+) << (\d+)/), "maxBody")
const maxBodyMB = (Number(shift[1]) << Number(shift[2])) / (1 << 20)

export const RECEIVE = {
  maxBodyMB,
  grpcCapped: /grpc\.MaxRecvMsgSize\(maxBody\)/.test(server),
  httpPaths: [...server.matchAll(/mux\.HandleFunc\("([^"]+)"/g)].map((m) => m[1]),
  headerTimeoutS: Number(must(server.match(/ReadHeaderTimeout: (\d+) \* time\.Second/), "ReadHeaderTimeout")[1]),
  listen: must(main.match(/fs\.String\("listen", "([^"]+)"/), "listen flag")[1],
  // Which metric shapes become rows: the cases metricPoints() handles.
  metricKinds: [...convert.matchAll(/case \*metricspb\.Metric_(\w+):/g)].map((m) => m[1]),
  importFiles: [...jsonl.matchAll(/filepath\.Join\(dir, "([^"]+)"\)/g)].map((m) => m[1]),
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(RECEIVE, null, 2))
