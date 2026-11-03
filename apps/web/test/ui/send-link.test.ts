import { describe, expect, it } from "vitest";
import { linkMessage, mailtoHref } from "../../src/ui/send-link";

const url = "http://localhost:3000/p/abc";

describe("linkMessage", () => {
  it("asks the person to answer, with their link and a note not to forward it", () => {
    const m = linkMessage("June", "Atlas launch sync", url, "answer");
    expect(m.subject).toBe('Your questions about "Atlas launch sync"');
    expect(m.body).toMatch(/^Hi June,\n\nHere is your private link/);
    expect(m.body).toContain(`\n\n${url}\n\n`);
    expect(m.body).toContain("please don't forward it");
    // The share sheet adds the link itself.
    expect(m.text).not.toContain(url);
  });

  it("after the reveal, asks them to help settle the wording", () => {
    const m = linkMessage("June", "Atlas launch sync", url, "settle");
    expect(m.subject).toBe('Settle the answers for "Atlas launch sync"');
    expect(m.body).toContain("help settle the wording");
  });
});

describe("mailtoHref", () => {
  it("leaves the address for the organizer and encodes subject and body", () => {
    expect(mailtoHref('A "b" & c', "line 1\nline 2")).toBe(
      "mailto:?subject=A%20%22b%22%20%26%20c&body=line%201%0Aline%202",
    );
  });
});
