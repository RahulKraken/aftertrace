#!/bin/sh
# Record the README demo GIF from fixture UI (Home → Findings).
#   sh web/scripts/gen-readme-demo.sh
# Needs Playwright Chromium and ffmpeg. Not run in CI.
set -eu
cd "$(dirname "$0")/.."
root=$(cd .. && pwd)
out="$root/docs/images/demo.gif"
export AFTERTRACE_README_DEMO=1
rm -rf test-results/readme-demo
mkdir -p test-results/readme-demo "$root/docs/images"

npx playwright test e2e/readme-demo.spec.ts --output test-results/readme-demo

webm=$(find test-results/readme-demo -name "*.webm" -print -quit)
[ -n "$webm" ] || { echo "gen-readme-demo: no webm in test-results/readme-demo" >&2; exit 1; }

# Accurate seek after -i so the first GIF frame is painted Home, not the
# blank/skeleton load. ~10 fps, 960px wide.
ffmpeg -y -i "$webm" -ss 1.4 -vf "fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=full[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3" "$out"
ls -lh "$out"
echo "wrote $out"
