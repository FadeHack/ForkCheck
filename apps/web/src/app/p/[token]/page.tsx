import type { Metadata } from "next";
import { Participant } from "../../../ui/participant/view";

export const metadata: Metadata = { title: "Your questions · ForkCheck" };

export default async function ParticipantPage({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
  return (
    <main>
      <Participant token={token} />
    </main>
  );
}
