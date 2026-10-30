"use client";

import { useEffect, useRef, useState } from "react";
import type { Segment } from "@forkcheck/core";
import { organizerToken } from "./api";
import { fetchRecording } from "./audio";
import { Button, ErrorNotice, timestamp } from "./components";

type Turn = Pick<Segment, "id" | "startMs" | "endMs">;

/**
 * Plays single turns of the stored recording. The file is fetched on the first play, since an
 * audio element can't send the organizer token, and each turn stops at its own end.
 */
export function useTurnPlayer(meetingId: string) {
  const audio = useRef<HTMLAudioElement>(null);
  const url = useRef<string | null>(null);
  const stopAt = useRef<number | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  function stop() {
    audio.current?.pause();
    stopAt.current = null;
    setPlaying(null);
  }

  async function toggle(turn: Turn) {
    const el = audio.current;
    if (el === null || turn.startMs === null) return;
    if (playing === turn.id) return stop();
    if (url.current === null) {
      setLoading(true);
      const res = await fetchRecording(meetingId, organizerToken(meetingId) ?? "");
      setLoading(false);
      if (!res.ok) return setFailure(res.message);
      url.current = URL.createObjectURL(res.blob);
      el.src = url.current;
    }
    setFailure(null);
    el.currentTime = turn.startMs / 1000;
    stopAt.current = turn.endMs === null ? null : turn.endMs / 1000;
    setPlaying(turn.id);
    await el.play().catch(() => {
      setPlaying(null);
      setFailure("This browser couldn't play the recording.");
    });
  }

  const element = (
    <audio
      ref={audio}
      preload="none"
      data-testid="turn-player"
      onTimeUpdate={(e) => {
        if (stopAt.current !== null && e.currentTarget.currentTime >= stopAt.current) stop();
      }}
      onEnded={stop}
    />
  );

  return { element, playing, loading, failure, toggle };
}

export type TurnPlayer = ReturnType<typeof useTurnPlayer>;

export function PlayButton({ player, turn }: { player: TurnPlayer; turn: Turn }) {
  if (turn.startMs === null) return null;
  const at = timestamp(turn.startMs);
  return (
    <Button variant="secondary" disabled={player.loading} onClick={() => void player.toggle(turn)}>
      {player.playing === turn.id ? "Stop playing" : `Play from ${at}`}
    </Button>
  );
}

export function PlayerFailure({ player }: { player: TurnPlayer }) {
  return player.failure === null ? null : <ErrorNotice>{player.failure}</ErrorNotice>;
}
