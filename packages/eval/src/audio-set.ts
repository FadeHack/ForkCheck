/**
 * The R§7.1 audio set: six scenarios rendered with synthetic voices and four read by a
 * volunteer. Recordings stay out of git, so entries name a file inside a local directory.
 */
export interface AudioSetEntry {
  scenarioId: string;
  source: "synthetic" | "human";
  /** File name inside the synthetic render directory or the human recordings directory. */
  file: string;
}

export const AUDIO_SET: readonly AudioSetEntry[] = [
  {
    scenarioId: "dev-deadline-next-friday",
    source: "synthetic",
    file: "dev-deadline-next-friday.clean.wav",
  },
  {
    scenarioId: "dev-ownership-outage-email",
    source: "synthetic",
    file: "dev-ownership-outage-email.clean.wav",
  },
  {
    scenarioId: "dev-scope-dashboard-demo",
    source: "synthetic",
    file: "dev-scope-dashboard-demo.clean.wav",
  },
  {
    scenarioId: "dev-partial-pricing-page",
    source: "synthetic",
    file: "dev-partial-pricing-page.clean.wav",
  },
  {
    scenarioId: "heldout-ownership-staging-cert",
    source: "synthetic",
    file: "heldout-ownership-staging-cert.clean.wav",
  },
  {
    scenarioId: "heldout-deadline-end-of-day-timezones",
    source: "synthetic",
    file: "heldout-deadline-end-of-day-timezones.clean.wav",
  },
  {
    scenarioId: "dev-aligned-key-rotation",
    source: "human",
    file: "dev-aligned-key-rotation.human.wav",
  },
  { scenarioId: "rec-analytics-renewal", source: "human", file: "rec-analytics-renewal.human.wav" },
  { scenarioId: "rec-ios-release", source: "human", file: "rec-ios-release.human.wav" },
  { scenarioId: "rec-postgres-upgrade", source: "human", file: "rec-postgres-upgrade.human.wav" },
];
