import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { generateClientSessionId } from "../core/ids.js";
import type { PersistedCopilotState } from "../types.js";

type ReadonlySessionManagerLike = {
  getSessionId(): string;
  getBranch(): SessionEntry[];
  getCwd?: () => string;
  getSessionDir?: () => string;
  getSessionFile?: () => string | undefined;
  getLeafId?: () => string;
  getLeafEntry?: () => SessionEntry | undefined;
  getEntry?: () => SessionEntry | undefined;
  getLabel?: () => string | undefined;
  [key: string]: unknown;
};

export class CopilotSessionStore {
  private readonly entries = new Map<string, PersistedCopilotState>();

  get(sessionId: string): PersistedCopilotState | undefined {
    return this.entries.get(sessionId);
  }

  getOrCreate(sessionId: string): PersistedCopilotState {
    const existing = this.entries.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: PersistedCopilotState = {
      version: 2,
      sessionId,
      conversationId: "",
      clientSessionId: generateClientSessionId(),
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(sessionId, created);
    return created;
  }

  set(state: PersistedCopilotState): void {
    this.entries.set(state.sessionId, state);
  }

  reconstruct(sessionManager: ReadonlySessionManagerLike): PersistedCopilotState | undefined {
    const sessionId = sessionManager.getSessionId();
    let state: PersistedCopilotState | undefined;

    for (const entry of sessionManager.getBranch()) {
      if (isCopilotStateEntry(entry)) {
        state = entry.data;
      }
    }

    if (state && state.sessionId === sessionId) {
      this.entries.set(sessionId, state);
      return state;
    }

    this.entries.delete(sessionId);
    return undefined;
  }
}

function isCopilotStateEntry(entry: SessionEntry): entry is SessionEntry & { type: "custom"; data: PersistedCopilotState } {
  return entry.type === "custom" && entry.customType === "microsoft-copilot-state" && Boolean(entry.data);
}
