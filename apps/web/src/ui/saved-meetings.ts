"use client";

import { useMemo, useSyncExternalStore } from "react";

/**
 * The meeting checks this browser created or opened as organizer, with their organizer tokens.
 * There are no accounts, so this list is the way back to a workspace without the original link.
 * It lives in localStorage on this device only; the server never sees it.
 */
export interface SavedMeeting {
  id: string;
  token: string;
  title: string;
  heldAt: string;
  timezone: string;
  /** When this browser last saved or opened it, for ordering. */
  savedAt: string;
  /**
   * Each person's link, kept from the create response: the server stores only token hashes, so
   * this is the one place the organizer can find them again. Absent for a check opened from a
   * link rather than created here.
   */
  participants?: SavedParticipant[];
}

export interface SavedParticipant {
  participantId: string;
  name: string;
  url: string;
}

const KEY = "forkcheck:meetings";
const CHANGE = "forkcheck:meetings-change";

function isSaved(v: unknown): v is SavedMeeting {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    ["id", "token", "title", "heldAt", "timezone", "savedAt"].every(
      (k) => typeof r[k] === "string",
    ) &&
    (r.participants === undefined ||
      (Array.isArray(r.participants) && r.participants.every(isParticipant)))
  );
}

function isParticipant(v: unknown): v is SavedParticipant {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return ["participantId", "name", "url"].every((k) => typeof r[k] === "string");
}

/** Parses the stored list; anything malformed is dropped rather than breaking the page. */
export function parseSaved(raw: string | null): SavedMeeting[] {
  if (raw === null) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter(isSaved) : [];
  } catch {
    return [];
  }
}

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function write(list: SavedMeeting[]) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage can be blocked; the list just isn't kept.
  }
  window.dispatchEvent(new Event(CHANGE));
}

/**
 * Adds the meeting, or refreshes its details and moves it to the top. Participant links already
 * saved are kept when a later save (opening the workspace) has none to give.
 */
export function saveMeeting(meeting: Omit<SavedMeeting, "savedAt">) {
  const list = parseSaved(read());
  const participants = meeting.participants ?? list.find((m) => m.id === meeting.id)?.participants;
  const rest = list.filter((m) => m.id !== meeting.id);
  const saved: SavedMeeting = { ...meeting, savedAt: new Date().toISOString() };
  if (participants) saved.participants = participants;
  write([saved, ...rest]);
}

export function forgetMeeting(id: string) {
  const list = parseSaved(read());
  if (list.some((m) => m.id === id)) write(list.filter((m) => m.id !== id));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE, onChange);
  // Another tab saving or removing a meeting.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * The raw stored string, so the snapshot is stable between renders; null on the server, where
 * there is no list to read yet.
 */
export function useSavedMeetings(): SavedMeeting[] | null {
  const raw = useSyncExternalStore(
    subscribe,
    () => read() ?? "",
    () => null,
  );
  return useMemo(() => (raw === null ? null : parseSaved(raw || null)), [raw]);
}
