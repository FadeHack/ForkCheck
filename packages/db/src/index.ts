export const packageName = "@forkcheck/db";

// Migrations live at `@forkcheck/db/migrate`: the app bundler cannot resolve the migrations folder.
export { connect, type Db, type DbHandle } from "./client";
export { DbCallLog, meetingModelCalls, type ModelCallRecord } from "./call-log";
export {
  MeetingRepo,
  type AnalysisProgress,
  type AnalysisStep,
  type NewMeeting,
  type SpeakerAssignment,
  type StepClaim,
  type StoredAnalysis,
  type StoredDecision,
} from "./repos/meetings";
export { RoundRepo } from "./repos/rounds";
export { SplitRepo } from "./repos/splits";
export * as tables from "./schema";
