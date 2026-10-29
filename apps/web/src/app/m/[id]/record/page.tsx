import type { Metadata } from "next";
import { RecordPage } from "../../../../ui/record/view";

export const metadata: Metadata = { title: "Decision record · ForkCheck" };

export default async function OrganizerRecordPage({ params }: PageProps<"/m/[id]/record">) {
  const { id } = await params;
  return (
    <main>
      <RecordPage meetingId={id} />
    </main>
  );
}
