import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DecisionRecord, RecordItem } from "@forkcheck/core";
import { ErrorNotice, Loading } from "../../src/ui/components";
import { QuestionsView, RevealView, RoundView } from "../../src/ui/organizer/views";
import { WorkspaceView } from "../../src/ui/organizer/workspace";
import { ParticipantView } from "../../src/ui/participant/view";
import { RecordView } from "../../src/ui/record/view";
import { CreatedLinks } from "../../src/ui/start/create-meeting";
import {
  answer,
  meeting,
  organizerState,
  participants,
  participantState,
  probe,
  round,
  split,
} from "./fixtures";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("shared states", () => {
  it("announces loading as status and failures as alerts", () => {
    expect(html(<Loading>Opening your questions.</Loading>)).toBe(
      '<p role="status">Opening your questions.</p>',
    );
    expect(html(<ErrorNotice>Nothing was saved.</ErrorNotice>)).toContain('role="alert"');
  });
});

describe("QuestionsView", () => {
  it("shows loading, failure and not-yet-drafted states", () => {
    const view = (status: typeof meeting.status, error: string | null = null) =>
      html(<QuestionsView state={organizerState({ meeting: { ...meeting, status, error } })} />);
    expect(view("analyzing")).toContain("Reading the transcript and drafting questions.");
    expect(
      view("failed", "Drafting stopped at 'find open details'. Retry from that step."),
    ).toContain("Drafting stopped at &#x27;find open details&#x27;");
    expect(view("draft")).toContain("Questions haven&#x27;t been drafted");
  });

  it("says so when no decisions were found", () => {
    expect(html(<QuestionsView state={organizerState()} />)).toContain(
      "No decisions with open details were found in this transcript.",
    );
  });

  it("lists decisions with their quotes and drafts with tier, detail and checks", () => {
    const state = organizerState({
      segments: [
        {
          id: "seg1",
          meetingId: "m1",
          idx: 0,
          speakerLabel: null,
          participantId: "p0",
          startMs: 20_000,
          endMs: null,
          text: "OK, so SSO is ready by Friday.",
          origin: "paste",
          edited: false,
        },
      ],
      decisions: [
        {
          decision: {
            id: "d1",
            meetingId: "m1",
            idx: 0,
            kind: "commitment",
            statement: "SSO is ready by Friday.",
            ownerText: "Marco",
            deadlineText: "Friday",
            ownerInferred: false,
            deadlineInferred: false,
            status: "ambiguous",
          },
          evidence: [
            {
              id: "e1",
              decisionId: "d1",
              resolutionId: null,
              segmentId: "seg1",
              quote: "SSO is ready by Friday",
            },
          ],
        },
      ],
      candidates: [
        {
          id: "c1",
          decisionId: "d1",
          dimension: "scope",
          readings: [
            { id: "r1", text: "staging" },
            { id: "r2", text: "production" },
          ],
          impact: { reversibility: "low", blastRadius: "high", timeToImpact: "high" },
        },
      ],
      probes: [
        probe("q1", {
          status: "draft",
          tier: "assisted",
          lint: [
            { rule: "presumes", detail: "Uses the word 'disagree', which presumes the answer" },
          ],
        }),
      ],
    });
    const out = html(<QuestionsView state={state} />);
    expect(out).toContain("<blockquote><p>SSO is ready by Friday</p></blockquote>");
    expect(out).toContain("Priya at 00:20");
    expect(out).toContain("Template with model options");
    expect(out).toContain("<dd>Scope</dd>");
    expect(out).toContain("which presumes the answer");
  });
});

describe("RoundView", () => {
  it("shows counts and names, never answers", () => {
    const state = organizerState({
      probes: [probe("q1")],
      rounds: [round("r1")],
      answerCounts: [{ probeId: "q1", answered: 2, active: 3 }],
      participants: [participants[0]!, participants[1]!, { ...participants[2]!, status: "absent" }],
    });
    const out = html(<RoundView state={state} />);
    expect(out).toContain("Question q1: 2 of 3 have answered.");
    expect(out).toContain("Dana: absent, not asked");
    expect(out).not.toContain("Staging");
  });

  it("says when no question is open", () => {
    expect(html(<RoundView state={organizerState()} />)).toContain(
      "No questions are open right now.",
    );
  });
});

describe("RevealView", () => {
  it("names who chose each option and who was not sure", () => {
    const state = organizerState({
      probes: [probe("q1")],
      splits: [split("s1", "q1")],
      revealedAnswers: [
        answer("p0", "q1", "q1-a"),
        answer("p1", "q1", "q1-b"),
        answer("p2", "q1", null),
      ],
    });
    const out = html(<RevealView state={state} />);
    expect(out).toContain("Different answers");
    expect(out).toContain("a difference to discuss.");
    expect(out).toContain("Chosen by Priya");
    expect(out).toContain("Chosen by Marco");
    expect(out).toContain("Not sure: Dana");
  });

  it("labels simulated answers", () => {
    const simulated = { ...answer("p0", "q1", "q1-a"), simulated: true };
    const state = organizerState({
      probes: [probe("q1")],
      splits: [split("s1", "q1")],
      revealedAnswers: [simulated],
    });
    expect(html(<RevealView state={state} />)).toContain("Priya (SIMULATED)");
  });
});

describe("WorkspaceView", () => {
  it("marks the current stage and leaves later stages inactive", () => {
    const out = html(
      <WorkspaceView state={organizerState({ rounds: [round("r1")] })} viewing={null} />,
    );
    expect(out).toContain('<li aria-current="step"><strong>Round</strong></li>');
    expect(out).toContain("Reveal, not yet");
    expect(out).toContain('href="/m/m1?stage=questions"');
  });
});

describe("ParticipantView", () => {
  const open = {
    id: "q1",
    kind: "diagnostic" as const,
    stem: "Which environment?",
    options: [{ id: "o1", text: "Staging" }],
  };

  it("covers not started, answering and waiting", () => {
    expect(html(<ParticipantView state={participantState()} token="t" />)).toContain(
      "hasn&#x27;t sent any questions yet",
    );
    const answering = html(
      <ParticipantView state={participantState({ openProbes: [open] })} token="t" />,
    );
    expect(answering).toContain("Nobody sees your answers until everyone has answered");
    expect(answering).toContain("<li>Not sure</li>");
    const waiting = participantState({
      openProbes: [open],
      ownAnswers: [answer("p0", "q1", "o1")],
    });
    expect(html(<ParticipantView state={waiting} token="t" />)).toContain(
      "You can change an answer until answers are revealed.",
    );
  });

  it("names only the participant after the reveal and counts the others", () => {
    const state = participantState({
      revealed: [
        {
          split: split("s1", "q1"),
          probe: { ...open, options: [...open.options, { id: "o2", text: "Production" }] },
          answers: [answer("p0", "q1", "o1"), answer("p1", "q1", "o2"), answer("p2", "q1", "o2")],
          resolutions: [],
          confirmations: [],
        },
      ],
    });
    const out = html(<ParticipantView state={state} token="t" />);
    expect(out).toContain("Chosen by You");
    expect(out).toContain("Chosen by 2 other people");
    expect(out).not.toContain("Marco");
  });
});

describe("RecordView", () => {
  const item = (overrides: Partial<RecordItem>): RecordItem => ({
    id: "i1",
    meetingId: "m1",
    category: "stated",
    text: "Dana tells the customer about Friday.",
    sourceRefs: [
      { kind: "segment", segmentId: "seg1", quote: "I'll tell them Friday.", origin: "asr" },
    ],
    confirmedBy: [],
    absent: [],
    recheck: "not_run",
    splitId: null,
    deadline: null,
    ...overrides,
  });
  const record = (items: RecordItem[]): DecisionRecord => ({
    meetingId: "m1",
    title: "Pilot customer check-in",
    heldAt: meeting.heldAt,
    generatedAt: meeting.createdAt,
    participants,
    items,
    proseDraft: null,
  });

  it("shows empty sections with their own copy and never claims alignment", () => {
    const out = html(
      <RecordView data={{ record: record([item({})]), validation: { ok: true, findings: [] } }} />,
    );
    expect(out).toContain("Nothing confirmed yet.");
    expect(out).toContain("Nothing unresolved.");
    expect(out).toContain("From automatic transcription");
    expect(out.toLowerCase()).not.toContain("aligned");
  });

  it("orders confirmed, unresolved, stated and shows confirmations and checks", () => {
    const out = html(
      <RecordView
        data={{
          record: record([
            item({
              id: "a",
              category: "confirmed",
              text: "SSO on production by Friday.",
              confirmedBy: ["p0", "p1"],
              recheck: "passed",
            }),
            item({ id: "b", category: "unresolved", text: "Provisioning scope.", absent: ["p2"] }),
          ]),
          validation: {
            ok: false,
            findings: [
              { rule: "quote", itemId: "a", detail: "A quote doesn't match the transcript." },
            ],
          },
        }}
      />,
    );
    expect(out.indexOf("Confirmed by participants")).toBeLessThan(out.indexOf("Unresolved"));
    expect(out.indexOf("Unresolved")).toBeLessThan(out.indexOf("Stated in meeting"));
    expect(out).toContain("Confirmed by Priya, Marco.");
    expect(out).toContain("Recheck passed: everyone gave the same answer.");
    expect(out).toContain("Absent, not asked: Dana.");
    expect(out).toContain("A quote doesn&#x27;t match the transcript.");
  });
});

describe("CreatedLinks", () => {
  it("puts the organizer token in the fragment and lists every participant link", () => {
    const out = html(
      <CreatedLinks
        created={{
          meetingId: "m1",
          organizerToken: "tok",
          participantLinks: [
            {
              participantId: "p0",
              displayName: "Priya",
              token: "pt",
              url: "http://localhost/p/pt",
            },
          ],
        }}
      />,
    );
    expect(out).toContain('href="/m/m1#k=tok"');
    expect(out).toContain('Priya: <a href="http://localhost/p/pt">');
    expect(out).toContain("It&#x27;s the only way back to this workspace.");
  });
});
