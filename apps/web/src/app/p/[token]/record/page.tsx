import type { Metadata } from "next";
import { RecordPage } from "../../../../ui/record/view";

export const metadata: Metadata = { title: "Decision record · ForkCheck" };

export default async function ParticipantRecordPage({ params }: PageProps<"/p/[token]/record">) {
  const { token } = await params;
  return (
    <main>
      <RecordPage token={token} />
    </main>
  );
}
