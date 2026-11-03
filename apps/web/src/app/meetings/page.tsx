import type { Metadata } from "next";
import { MeetingList } from "../../ui/meetings/list";

export const metadata: Metadata = { title: "Your meetings · ForkCheck" };

export default function MeetingsPage() {
  return (
    <main className="meetings">
      <h1>Your meetings</h1>
      <p className="start-intro">
        Meeting checks started or opened as organizer in this browser. The list stays on this
        device, and anyone using this browser can open them.
      </p>
      <MeetingList />
    </main>
  );
}
