import type { Metadata } from "next";
import { Suspense } from "react";
import { Workspace } from "../../../ui/organizer/workspace";

export const metadata: Metadata = { title: "Meeting check · ForkCheck" };

export default async function OrganizerPage({ params }: PageProps<"/m/[id]">) {
  const { id } = await params;
  return (
    <main>
      <Suspense>
        <Workspace meetingId={id} />
      </Suspense>
    </main>
  );
}
