# shellcheck shell=sh
# Prepare electron-builder signing/notarization env for CI.
# Source from desktop/scripts/ci-pack.sh. Empty GitHub secrets become "" and
# electron-builder then treats CSC_LINK as a path (the project directory) and
# fails; unset those. If APPLE_API_KEY is the .p8 contents rather than a path,
# write it to a temp file. Unsigned builds must still succeed.

unset_if_empty() {
  eval "val=\${$1-}"
  if [ -z "$val" ]; then
    unset "$1" 2>/dev/null || true
  fi
}

for key in CSC_LINK CSC_KEY_PASSWORD APPLE_ID APPLE_APP_SPECIFIC_PASSWORD APPLE_TEAM_ID APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
  unset_if_empty "$key"
done

if [ -n "${APPLE_API_KEY-}" ] && [ ! -f "$APPLE_API_KEY" ]; then
  keyfile="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/AuthKey.p8"
  # GitHub secrets may store literal \n instead of real newlines.
  python3 -c 'import os, sys; sys.stdout.write(os.environ["APPLE_API_KEY"].replace("\\n", "\n"))' >"$keyfile"
  chmod 600 "$keyfile"
  APPLE_API_KEY="$keyfile"
  export APPLE_API_KEY
fi

if [ -z "${CSC_LINK-}" ]; then
  CSC_IDENTITY_AUTO_DISCOVERY=false
  export CSC_IDENTITY_AUTO_DISCOVERY
  echo "Signing skipped: CSC_LINK is not set."
else
  echo "Signing enabled (CSC_LINK is set)."
fi

if [ -n "${APPLE_ID-}" ] || [ -n "${APPLE_API_KEY-}" ]; then
  echo "Notarization credentials present."
else
  echo "Notarization skipped: no APPLE_ID or APPLE_API_KEY."
fi
