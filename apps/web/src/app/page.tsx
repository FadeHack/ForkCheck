import { CreateMeeting } from "../ui/start/create-meeting";
import { CheckedDimensions } from "./checked-dimensions";

export default function HomePage() {
  return (
    <main className="start">
      <h1>Check what your meeting decided</h1>
      <p className="start-intro">
        Paste a meeting transcript or upload a recording. ForkCheck finds decisions whose details
        could be read more than one way, asks each participant short private questions about them,
        and shows where the answers differ so you can settle the wording together. A recording is
        sent to Meta for transcription. The transcript and the participant names are sent to
        Meta&apos;s model API for analysis, unless you choose to hide the names.
      </p>
      <CheckedDimensions />
      <CreateMeeting />
    </main>
  );
}
