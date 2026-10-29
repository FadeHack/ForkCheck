import { CreateMeeting } from "../ui/start/create-meeting";
import { CheckedDimensions } from "./checked-dimensions";

export default function HomePage() {
  return (
    <main>
      <h1>ForkCheck</h1>
      <p>
        Paste a meeting transcript. ForkCheck finds decisions whose details could be read more than
        one way, asks each participant short private questions about them, and shows where the
        answers differ so you can settle the wording together. The transcript and the participant
        names are sent to Meta&apos;s model API for analysis.
      </p>
      <CheckedDimensions />
      <CreateMeeting />
    </main>
  );
}
