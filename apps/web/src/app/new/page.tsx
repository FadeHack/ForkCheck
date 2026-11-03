import type { Metadata } from "next";
import { CreateMeeting } from "../../ui/start/create-meeting";
import { CheckedDimensions } from "./checked-dimensions";

export const metadata: Metadata = { title: "New meeting check · ForkCheck" };

export default async function NewMeetingPage({ searchParams }: PageProps<"/new">) {
  const { sample } = await searchParams;
  return (
    <main className="start">
      <h1>Check a meeting</h1>
      <p className="start-intro">
        Paste a meeting transcript or upload a recording. A recording is sent to Meta for
        transcription. The transcript and the participant names are sent to Meta&apos;s model API
        for analysis, unless you choose to hide the names.
      </p>
      <CheckedDimensions />
      <CreateMeeting sample={sample !== undefined} />
    </main>
  );
}
