#!/bin/sh
# Confirm the Apple-silicon Mac package: the app ships the arm64 Go engine,
# Aftertrace-mac.dmg is a copy of the arm64 DMG, and when Apple secrets
# signed+notarized the build, stapler validates the DMG and spctl accepts
# the app. Run from desktop/ after electron-builder and stable-artifacts.
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
x64_app=$(find_app x86_64) || x64_app=""
if [ -n "$x64_app" ] && [ "$arm_app" = "$x64_app" ]; then
  echo "arm64 and x64 resolved to the same app bundle: $arm_app" >&2
  exit 1
fi

echo "arm64 app: $arm_app" | tee -a "$report"
check_engine "$arm_app" arm64
if [ -n "$x64_app" ]; then
  echo "x64 app (optional): $x64_app" | tee -a "$report"
  check_engine "$x64_app" x86_64
fi

for app in $arm_app $x64_app; do
  if [ -f "$app/Contents/LICENSE" ]; then
    echo "LICENSE must not sit at $app/Contents/LICENSE (codesign nested code)" >&2
    exit 1
  fi
  if [ ! -s "$app/Contents/Resources/LICENSE" ]; then
    echo "LICENSE missing from $app/Contents/Resources/LICENSE" >&2
    exit 1
  fi
  echo "LICENSE ok: $app/Contents/Resources/LICENSE" | tee -a "$report"
done

for f in \
  Aftertrace-mac-arm64.dmg Aftertrace-mac-arm64.zip \
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
if grep -q "Aftertrace-mac-x64.zip" "$dist/latest-mac.yml"; then
  echo "latest-mac.yml must not list Aftertrace-mac-x64.zip (Apple-silicon-only consumer)" >&2
  cat "$dist/latest-mac.yml" >&2
  exit 1
fi

if [ -n "${CSC_LINK-}" ]; then
  echo "Developer ID:" | tee -a "$report"
  for app in $arm_app $x64_app; do
    echo "codesign $app" | tee -a "$report"
    ident=$(codesign -dv --verbose=4 "$app" 2>&1)
    echo "$ident" | tee -a "$report"
    echo "$ident" | grep -q "Developer ID Application:" || {
      echo "missing Developer ID Application on $app" >&2
      exit 1
    }
    codesign -v "$app" || {
      echo "codesign -v failed for $app" >&2
      exit 1
    }
  done
fi

if [ -f "$dist/Aftertrace-mac-notarized.json" ]; then
  notarize_arches=${NOTARIZE_MAC_ARCHES:-arm64}
  echo "Signed+notarized arches: $notarize_arches" | tee -a "$report"
  wants_arch() {
    case ",$notarize_arches," in
      *",$1,"*) return 0 ;;
      *) return 1 ;;
    esac
  }
  # Gatekeeper assesses the .app. `spctl --type install` is for installer
  # packages; a Developer ID DMG reports "no usable signature" even when
  # stapler validate works and the app is Notarized Developer ID. Ticket is
  # on the DMG (stapler); assessment is on the app (spctl -a -vv).
  staple_dmg() {
    dmg=$1
    echo "stapler $dmg" | tee -a "$report"
    xcrun stapler validate "$dmg" 2>&1 | tee -a "$report"
    echo "spctl --type install (informational) $dmg" | tee -a "$report"
    spctl -a -vv --type install "$dmg" 2>&1 | tee -a "$report" || true
  }
  assess_app() {
    app=$1
    echo "spctl $app" | tee -a "$report"
    out=$(spctl -a -vv "$app" 2>&1) || true
    echo "$out" | tee -a "$report"
    echo "$out" | grep -qi "accepted" || {
      echo "spctl did not accept $app" >&2
      exit 1
    }
    echo "$out" | grep -qi "Notarized Developer ID" || {
      echo "spctl did not report Notarized Developer ID for $app" >&2
      exit 1
    }
  }
  if wants_arch arm64; then
    staple_dmg "$dist/Aftertrace-mac-arm64.dmg"
    staple_dmg "$dist/Aftertrace-mac.dmg"
    assess_app "$arm_app"
  fi
  if wants_arch x64; then
    if [ -z "$x64_app" ] || [ ! -f "$dist/Aftertrace-mac-x64.dmg" ]; then
      echo "NOTARIZE_MAC_ARCHES includes x64 but the Intel app/DMG is missing" >&2
      exit 1
    fi
    staple_dmg "$dist/Aftertrace-mac-x64.dmg"
    assess_app "$x64_app"
  fi
elif [ -n "${CSC_LINK-}" ]; then
  echo "Signed, notarization not stapled (no Aftertrace-mac-notarized.json)" | tee -a "$report"
else
  echo "Unsigned (or sign-only): skipping spctl/stapler" | tee -a "$report"
fi
