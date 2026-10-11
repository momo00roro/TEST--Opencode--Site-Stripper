import { randomUUID } from "node:crypto";
import type { AnalysisResult } from "../src/pipeline/analysis.js";

export const MAX_AGENT_RUNS = 3;
export const MAX_AGENT_ACTIVITY_EVENTS = 50;
export const AGENT_RUN_IDLE_TTL_MS = 30 * 60 * 1000;

export type AgentRunId = string;
export type AgentRunStatus = "analyzing" | "complete" | "failed";
export type AgentActivityInput = Omit<AgentActivityEvent, "id" | "at">;

export interface AgentRunRecord {
  id: AgentRunId;
  createdAt: number;
  lastUsedAt: number;
  sourceUrl: string;
  status: AgentRunStatus;
  result?: AnalysisResult;
  failureSummary?: string;
}

export interface AgentActivityEvent {
  id: string;
  at: number;
  kind: "analysis-started" | "analysis-complete" | "analysis-failed" | "evidence-read";
  runId?: AgentRunId;
  summary: string;
}

export interface AgentActivitySnapshot {
  activeRunIds: AgentRunId[];
  lastAgentCallAt?: number;
  events: AgentActivityEvent[];
}

export interface AgentActivityResponse extends AgentActivitySnapshot {
  mcpEndpoint: string;
}

export interface AgentStateStore {
  beginRun(sourceUrl: string): AgentRunId;
  completeRun(runId: AgentRunId, result: AnalysisResult): void;
  failRun(runId: AgentRunId, summary: string): void;
  getRun(runId: AgentRunId): AgentRunRecord | undefined;
  recordActivity(event: AgentActivityInput): AgentActivityEvent;
  getRecentActivity(limit?: number): AgentActivityEvent[];
  getSnapshot(): AgentActivitySnapshot;
}

export class AgentRunCapacityError extends Error {
  constructor() {
    super("All available local analysis slots are busy. Wait for an analysis to finish, then try again.");
    this.name = "AgentRunCapacityError";
  }
}

export class AgentRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Analysis run ${runId} was not found or has expired. Start a new analysis and use its run ID.`);
    this.name = "AgentRunNotFoundError";
  }
}

function copyRun(record: AgentRunRecord): AgentRunRecord {
  return structuredClone(record);
}

function copyEvent(event: AgentActivityEvent): AgentActivityEvent {
  return { ...event };
}

export function createAgentStateStore(now: () => number = Date.now): AgentStateStore {
  const runs = new Map<AgentRunId, AgentRunRecord>();
  const events: AgentActivityEvent[] = [];

  function expireIdleRuns(): void {
    const currentTime = now();
    for (const [runId, record] of runs) {
      if (record.status !== "analyzing" && currentTime - record.lastUsedAt >= AGENT_RUN_IDLE_TTL_MS) {
        runs.delete(runId);
      }
    }
  }

  function requireRun(runId: AgentRunId): AgentRunRecord {
    expireIdleRuns();
    const record = runs.get(runId);
    if (!record) throw new AgentRunNotFoundError(runId);
    return record;
  }

  return {
    beginRun(sourceUrl) {
      expireIdleRuns();
      if (runs.size >= MAX_AGENT_RUNS) {
        const evictable = [...runs.values()]
          .filter((record) => record.status !== "analyzing")
          .sort((left, right) => left.lastUsedAt - right.lastUsedAt)[0];
        if (!evictable) throw new AgentRunCapacityError();
        runs.delete(evictable.id);
      }

      const createdAt = now();
      const id = randomUUID();
      runs.set(id, {
        id,
        createdAt,
        lastUsedAt: createdAt,
        sourceUrl: new URL(sourceUrl.trim()).href,
        status: "analyzing",
      });
      return id;
    },

    completeRun(runId, result) {
      const record = requireRun(runId);
      const at = now();
      runs.set(runId, {
        ...record,
        lastUsedAt: at,
        status: "complete",
        result: structuredClone(result),
        failureSummary: undefined,
      });
    },

    failRun(runId, summary) {
      const record = requireRun(runId);
      runs.set(runId, {
        ...record,
        lastUsedAt: now(),
        status: "failed",
        result: undefined,
        failureSummary: summary.slice(0, 500),
      });
    },

    getRun(runId) {
      const record = runs.get(runId);
      if (!record) {
        expireIdleRuns();
        return undefined;
      }
      record.lastUsedAt = now();
      return copyRun(record);
    },

    recordActivity(input) {
      expireIdleRuns();
      const event: AgentActivityEvent = {
        ...input,
        id: randomUUID(),
        at: now(),
        summary: input.summary.slice(0, 240),
      };
      events.push(event);
      if (events.length > MAX_AGENT_ACTIVITY_EVENTS) {
        events.splice(0, events.length - MAX_AGENT_ACTIVITY_EVENTS);
      }
      return copyEvent(event);
    },

    getRecentActivity(limit = MAX_AGENT_ACTIVITY_EVENTS) {
      expireIdleRuns();
      const boundedLimit = Math.max(0, Math.min(MAX_AGENT_ACTIVITY_EVENTS, Math.floor(limit)));
      return boundedLimit === 0 ? [] : events.slice(-boundedLimit).map(copyEvent);
    },

    getSnapshot() {
      expireIdleRuns();
      const recentEvents = events.slice(-MAX_AGENT_ACTIVITY_EVENTS).map(copyEvent);
      const lastEvent = events.at(-1);
      return {
        activeRunIds: [...runs.values()]
          .filter((record) => record.status === "analyzing")
          .map((record) => record.id),
        ...(lastEvent ? { lastAgentCallAt: lastEvent.at } : {}),
        events: recentEvents,
      };
    },
  };
}
