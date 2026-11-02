#!/usr/bin/env bash
# Rebuilds atlas-launch.flac, the audio version of the demo meeting, with macOS text-to-speech
# (one voice per person). Needs macOS `say` and ffmpeg; everyone else uses the committed file.
# FLAC is lossless, so every ffmpeg decodes it to the same samples and a replayed
# transcription keyed by the converted WAV matches everywhere.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pnpm --silent audio:render "$here/atlas-launch.json" --out "$work"
ffmpeg -loglevel error -y -i "$work/demo-atlas-launch.clean.wav" -ac 1 \
  -c:a flac -sample_fmt s16 -map_metadata -1 -fflags +bitexact "$here/atlas-launch.flac"
