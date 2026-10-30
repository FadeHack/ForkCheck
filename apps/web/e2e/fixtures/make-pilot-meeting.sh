#!/usr/bin/env bash
# Rebuilds pilot-meeting.flac from pilot-meeting.txt with macOS text-to-speech, one voice per
# person. Needs macOS `say` and ffmpeg. CI never runs this; it uses the committed file.
# FLAC is lossless, so every ffmpeg decodes it to the same samples and the replayed
# transcription, keyed by the converted WAV, matches everywhere. MP3 decoders differ.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

voice() {
  case "$1" in
    Priya) echo Samantha ;;
    Marco) echo Daniel ;;
    Dana) echo Karen ;;
    *) echo "unknown speaker $1" >&2; exit 1 ;;
  esac
}

ffmpeg -loglevel error -f lavfi -i anullsrc=r=24000:cl=mono -t 1.0 -c:a pcm_s16le "$work/gap.wav"
: > "$work/list.txt"
n=0
while IFS= read -r line; do
  [ -z "$line" ] && continue
  who="${line%%:*}"
  words="${line#*: }"
  n=$((n + 1))
  say -v "$(voice "$who")" -r 135 -o "$work/$n.aiff" "$words"
  ffmpeg -loglevel error -i "$work/$n.aiff" -ac 1 -ar 24000 -c:a pcm_s16le "$work/$n.wav"
  printf "file '%s'\nfile '%s'\n" "$work/$n.wav" "$work/gap.wav" >> "$work/list.txt"
done < "$here/pilot-meeting.txt"

ffmpeg -loglevel error -y -f concat -safe 0 -i "$work/list.txt" -ac 1 -ar 24000 \
  -c:a flac -sample_fmt s16 -map_metadata -1 -fflags +bitexact "$here/pilot-meeting.flac"
