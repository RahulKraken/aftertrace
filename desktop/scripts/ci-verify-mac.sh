#!/bin/sh
# Confirm per-chip Mac packages: each app ships one matching Go engine,
# Aftertrace-mac.dmg is a copy of the arm64 DMG, and when Apple secrets
# signed+notarized the build, the DMGs pass Gatekeeper and stapler.
# Run from desktop/ after electron-builder and stable-artifacts.
set -eu
cd "$(dirname "$0")/.."

dist=dist
report="$dist/mac-engine-report.txt"
mkdir -p "$dist"
: >"$report"
echo "dist trees:" | tee -a "$report"
for d in "$dist"/mac*; do
  [ -e "$d" ] || continue
  echo "$d" | tee -a "$report"
done

# electron-builder may use mac-arm64 / mac-x64, or mac (host arch) plus a
# suffixed dir for the other chip. Identify by the bundled engine, not the path.
find_app() {
  want=$1
  found=""
  for cand in "$dist"/mac*/Aftertrace.app; do
    [ -d "$cand" ] || continue
    bin="$cand/Contents/Resources/engine/aftertrace"
    [ -f "$bin" ] || continue
    info=$(file "$bin")
    echo "$info" | grep -q "$want" || continue
    if echo "$info" | grep -qi "universal"; then
      echo "fat engine in $cand" >&2
      exit 1
    fi
    if [ -n "$found" ]; then
      echo "multiple $want apps: $found and $cand" >&2
      exit 1
    fi
    found=$cand
  done
  if [ -z "$found" ]; then
    return 1
  fi
  echo "$found"
}

check_engine() {
  app=$1
  want=$2
  bin="$app/Contents/Resources/engine/aftertrace"
  if [ ! -f "$bin" ]; then
    echo "missing engine at $bin" >&2
    exit 1
  fi
  info=$(file "$bin")
  echo "$info" | tee -a "$report"
  echo "$info" | grep -q "$want" || {
    echo "engine at $bin is not $want" >&2
    exit 1
  }
  if command -v lipo >/dev/null 2>&1; then
    lipo_info=$(lipo -info "$bin")
    echo "$lipo_info" | tee -a "$report"
    echo "$lipo_info" | grep -qi "Non-fat" || {
      echo "engine at $bin is fat/universal" >&2
      exit 1
    }
    echo "$lipo_info" | grep -q "$want" || {
      echo "lipo arch mismatch at $bin (want $want)" >&2
      exit 1
    }
  fi
}

arm_app=$(find_app arm64) || {
  echo "mac-arm64 Aftertrace.app not found under $dist" >&2
  ls -la "$dist" >&2
  exit 1
}
x64_app=$(find_app x86_64) || {
  echo "mac x86_64 Aftertrace.app not found under $dist" >&2
  ls -la "$dist" >&2
  exit 1
}
if [ "$arm_app" = "$x64_app" ]; then
  echo "arm64 and x64 resolved to the same app bundle: $arm_app" >&2
  exit 1
fi

echo "arm64 app: $arm_app" | tee -a "$report"
check_engine "$arm_app" arm64
echo "x64 app: $x64_app" | tee -a "$report"
check_engine "$x64_app" x86_64

for f in \
  Aftertrace-mac-arm64.dmg Aftertrace-mac-x64.dmg \
  Aftertrace-mac-arm64.zip Aftertrace-mac-x64.zip \
  Aftertrace-mac.dmg Aftertrace-mac.zip latest-mac.yml; do
  if [ ! -f "$dist/$f" ]; then
    echo "missing $dist/$f" >&2
    ls -la "$dist" >&2
    exit 1
  fi
done

cmp -s "$dist/Aftertrace-mac.dmg" "$dist/Aftertrace-mac-arm64.dmg" || {
  echo "Aftertrace-mac.dmg is not a copy of Aftertrace-mac-arm64.dmg" >&2
  exit 1
}

python3 - "$dist" "$report" <<'PY'
import os, sys
dist, report = sys.argv[1], sys.argv[2]
names = sorted(n for n in os.listdir(dist) if n.startswith("Aftertrace-mac") and (n.endswith(".dmg") or n.endswith(".zip")))
lines = []
for name in names:
    size = os.path.getsize(os.path.join(dist, name))
    lines.append(f"{name}: {size / (1024*1024):.1f} MB ({size} bytes)")
body = "\n".join(lines) + "\n"
print(body, end="")
with open(report, "a", encoding="utf-8") as fh:
    fh.write(body)
PY

grep -q "Aftertrace-mac-arm64.zip" "$dist/latest-mac.yml"
grep -q "Aftertrace-mac-x64.zip" "$dist/latest-mac.yml"

if [ -n "${CSC_LINK-}" ] && { [ -n "${APPLE_ID-}" ] || [ -n "${APPLE_API_KEY-}" ]; }; then
  echo "Signed+notarized: Gatekeeper and stapler" | tee -a "$report"
  for dmg in "$dist/Aftertrace-mac-arm64.dmg" "$dist/Aftertrace-mac-x64.dmg" "$dist/Aftertrace-mac.dmg"; do
    echo "spctl $dmg" | tee -a "$report"
    # Disk images need --type install; -vv is the assess verbose form.
    spctl -a -vv --type install "$dmg" 2>&1 | tee -a "$report"
    xcrun stapler validate "$dmg" 2>&1 | tee -a "$report"
  done
  for app in "$arm_app" "$x64_app"; do
    echo "spctl $app" | tee -a "$report"
    spctl -a -vv "$app" 2>&1 | tee -a "$report"
  done
else
  echo "Unsigned (or sign-only): skipping spctl/stapler" | tee -a "$report"
fi
