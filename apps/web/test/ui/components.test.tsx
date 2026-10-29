import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Banner,
  Button,
  Field,
  ForkView,
  SpeakerChip,
  StatusLabel,
  Toast,
  type Status,
} from "../../src/ui/components";
import type { Answer } from "@forkcheck/core";
import { answer, participants, probe, split } from "./fixtures";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

describe("Button", () => {
  it("is a plain button unless told to submit", () => {
    expect(html(<Button>Copy link</Button>)).toBe(
      '<button type="button" class="button button-primary">Copy link</button>',
    );
    expect(html(<Button variant="secondary" type="submit" />)).toContain(
      'type="submit" class="button button-secondary"',
    );
  });
});

describe("Field", () => {
  it("describes the control by its hint and error", () => {
    const out = html(
      <Field id="t" label="Transcript" hint="One turn per line." error="Paste a transcript.">
        {(d) => <textarea id="t" aria-describedby={d} />}
      </Field>,
    );
    expect(out).toContain('<label for="t">Transcript</label>');
    expect(out).toContain('aria-describedby="t-hint t-error"');
    expect(out).toContain('<span id="t-hint" class="field-hint">One turn per line.</span>');
    expect(out).toContain('<p id="t-error" class="field-error">Paste a transcript.</p>');
  });

  it("adds a warning between the hint and the error", () => {
    const out = html(
      <Field id="t" label="Transcript" hint="One turn per line." warning={<p>Sam is unknown.</p>}>
        {(d) => <textarea id="t" aria-describedby={d} />}
      </Field>,
    );
    expect(out).toContain('aria-describedby="t-hint t-warning"');
    expect(out).toContain('<div id="t-warning" class="field-warning"><p>Sam is unknown.</p></div>');
  });

  it("leaves the control undescribed when there is nothing to say", () => {
    const out = html(
      <Field id="t" label="Title">
        {(d) => <input id="t" aria-describedby={d} />}
      </Field>,
    );
    expect(out).not.toContain("aria-describedby");
  });

  it("puts a checkbox before its label", () => {
    const out = html(
      <Field id="c" label="Everyone agreed" check>
        {() => <input id="c" type="checkbox" />}
      </Field>,
    );
    expect(out.indexOf("<input")).toBeLessThan(out.indexOf("<label"));
  });
});

describe("StatusLabel", () => {
  const all: Status[] = [
    "split",
    "consistent",
    "insufficient",
    "open",
    "resolving",
    "confirmed",
    "rechecked",
    "reopened",
    "unresolved",
    "not_conclusive",
  ];

  it.each(all)("%s carries text and a hidden glyph, never color alone", (status) => {
    const out = html(<StatusLabel status={status} />);
    expect(out.replace(/<[^>]+>/g, "").trim().length).toBeGreaterThan(0);
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"[^>]*data-glyph="\w+"/);
  });

  it("uses the fork glyph for a split and the check for a confirmation", () => {
    expect(html(<StatusLabel status="split" />)).toContain('data-glyph="fork"');
    expect(html(<StatusLabel status="confirmed" />)).toContain('data-glyph="check"');
    expect(html(<StatusLabel status="unresolved" />)).toContain("status-unresolved");
  });
});

describe("ForkView", () => {
  const q = probe("q1");
  const fork = (outcome: "split" | "consistent" | "insufficient", answers: Answer[]) =>
    html(
      <ForkView
        stem={q.stem}
        options={q.options}
        split={{ ...split("s1", "q1"), outcome }}
        answers={answers}
        people={participants}
      />,
    );
  const text = (s: string) => s.replace(/<[^>]+>/g, "").replaceAll("&#x27;", "'");

  it("draws one branch per chosen option and marks the split", () => {
    const out = fork("split", [answer("p0", "q1", "q1-a"), answer("p1", "q1", "q1-b")]);
    expect(out).toContain('data-outcome="split"');
    expect(out.match(/class="fork-branch"/g)).toHaveLength(2);
    expect(text(out)).toContain("Different answers: a difference to discuss.");
    expect(text(out)).toContain("Dana didn't answer.");
  });

  it("keeps a single stem when everyone chose the same option, with coverage", () => {
    const out = fork("consistent", [answer("p0", "q1", "q1-a"), answer("p1", "q1", "q1-a")]);
    expect(out).toContain('data-outcome="consistent"');
    expect(out.match(/class="fork-branch"/g)).toHaveLength(1);
    expect(text(out)).toContain("Chosen by Priya and Marco");
    expect(text(out)).toContain("Same answer (2 of 3 answered).");
  });

  it("says why there is not enough to compare", () => {
    const out = text(fork("insufficient", [answer("p0", "q1", "q1-a"), answer("p2", "q1", null)]));
    expect(out).toContain("Not enough answers to compare.");
    expect(out).toContain("Dana was not sure.");
    expect(out).toContain("Marco didn't answer.");
  });

  it("does not count an absent participant as asked", () => {
    const people = participants.map((p, i) => (i === 2 ? { ...p, status: "absent" as const } : p));
    const out = html(
      <ForkView
        stem={q.stem}
        options={q.options}
        split={{ ...split("s1", "q1"), outcome: "consistent" }}
        answers={[answer("p0", "q1", "q1-a"), answer("p1", "q1", "q1-a")]}
        people={people}
      />,
    );
    expect(text(out)).toContain("Same answer (2 of 2 answered).");
    expect(out).not.toContain("Dana");
  });
});

describe("notices", () => {
  it("labels simulated speakers in text", () => {
    expect(html(<SpeakerChip name="Leo" simulated />)).toContain(
      'Leo<span class="speaker-simulated"> (SIMULATED)</span>',
    );
  });

  it("keeps the toast region in the page while it is empty", () => {
    expect(html(<Toast message="" />)).toBe('<div role="status" class="toast"></div>');
  });

  it("states a banner's label in words", () => {
    expect(html(<Banner label="SIMULATED">Generated answers.</Banner>)).toContain(
      "<strong>SIMULATED.</strong> Generated answers.",
    );
  });
});
