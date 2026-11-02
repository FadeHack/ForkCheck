import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mapStrings, pseudonyms } from "../src/index";

const names = ["Nadia Park", "Tomas", "June", "Zoë"];

describe("pseudonyms", () => {
  const p = pseudonyms(names);

  it("hides every word of every name, whole words only", () => {
    expect(p.hide("Nadia Park: Tomas, can June ship before Zoë's review?")).toBe(
      "Person A Surname A: Person B, can Person C ship before Person D's review?",
    );
    expect(p.hide("Nadia said the park opens in Junes")).toBe(
      "Person A said the park opens in Junes",
    );
    expect(p.hide("Tomasz and Zoëy")).toBe("Tomasz and Zoëy");
  });

  it("maps a reply's placeholders back to the names", () => {
    expect(p.reveal("Person A Surname A owns it; Person C disagrees")).toBe(
      "Nadia Park owns it; June disagrees",
    );
    expect(p.reveal("Person AB and Person E are not anyone")).toBe(
      "Person AB and Person E are not anyone",
    );
  });

  it("property: revealing what was hidden gives back the original text", () => {
    const word = fc.constantFrom(
      ...names,
      "Nadia",
      "Park",
      "the",
      "Junes",
      "Tomas's",
      "ship",
      "Friday,",
    );
    fc.assert(
      fc.property(fc.array(fc.oneof(word, fc.string()), { maxLength: 12 }), (parts) => {
        const text = parts.join(" ");
        fc.pre(!/Person|Surname/.test(text));
        const hidden = p.hide(text);
        for (const n of ["Nadia", "Park", "Tomas", "June", "Zoë"]) {
          expect(hidden).not.toMatch(
            new RegExp(`(?<![\\p{L}\\p{N}_])${n}(?![\\p{L}\\p{N}_])`, "u"),
          );
        }
        expect(p.reveal(hidden)).toBe(text);
      }),
    );
  });

  it("names placeholders past Z with two letters, and gives a shared word one placeholder", () => {
    const many = pseudonyms([...Array.from({ length: 27 }, (_, i) => `Name${i}`)]);
    expect(many.hide("Name26")).toBe("Person AA");
    const shared = pseudonyms(["Ana Park", "Ben Park"]);
    expect(shared.hide("Ana Park and Ben Park")).toBe("Person A Surname A and Person B Surname A");
    expect(shared.reveal("Person B Surname A")).toBe("Ben Park");
  });
});

describe("mapStrings", () => {
  it("maps string values at any depth and leaves keys and other values", () => {
    const out = mapStrings({ June: "June", n: 1, list: ["June", null, { owner: "June" }] }, (s) =>
      s.toUpperCase(),
    );
    expect(out).toEqual({ June: "JUNE", n: 1, list: ["JUNE", null, { owner: "JUNE" }] });
  });
});
