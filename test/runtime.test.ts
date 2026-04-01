import EventEmitter from "node:events";
import { createHash } from "node:crypto";
import WebSocket from "ws";
import { describe, expect, test } from "vitest";
import type { Model } from "@mariozechner/pi-ai";
import { CopilotSessionRuntime } from "../src/runtime/session-runtime.js";
import type { CopilotConfig } from "../src/types.js";

class MockSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING as unknown as number;
  sent: Record<string, unknown>[] = [];

  constructor() {
    super();
    queueMicrotask(() => {
      this.readyState = WebSocket.OPEN as unknown as number;
      this.emit("open");
    });
  }

  send(payload: string): void {
    this.sent.push(JSON.parse(payload));
  }

  close(): void {
    this.readyState = WebSocket.CLOSED as unknown as number;
    this.emit("close", 1000, Buffer.from("closed"));
  }
}


const model: Model<"openai-completions"> = {
  id: "copilot",
  name: "Microsoft Copilot",
  api: "openai-completions",
  provider: "microsoft-copilot" as any,
  baseUrl: "https://copilot.microsoft.com/c/api",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 8192
};

const baseConfig: CopilotConfig = {
  accessToken: "token",
  cookie: "",
  mode: "reasoning",
  channel: "edge",
  apiVersion: "2",
  debug: false,
  trace: false,
  origin: "https://copilot.microsoft.com",
  userAgent: "test-agent"
};

function createFetchMock(overrides: {
  conversationId?: string;
  maxTextMessageLength?: number;
  onConversationCreate?: (url: string) => Response | Promise<Response>;
} = {}) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/c/api/config")) {
      return new Response(
        JSON.stringify({
          maxTextMessageLength: overrides.maxTextMessageLength ?? 10240
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }

    if (url.includes("/c/api/conversations")) {
      if (overrides.onConversationCreate) {
        return overrides.onConversationCreate(url);
      }

      return new Response(JSON.stringify({ conversationId: overrides.conversationId ?? "conv-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unexpected fetch URL: ${url}`);
  };
}

async function collectEvents(stream: AsyncIterable<any>): Promise<any[]> {
  const events: any[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function waitFor(assertion: () => void): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  assertion();
}

describe("session runtime", () => {
  test("bootstraps a conversation and maps websocket streaming into pi events", async () => {
    const sockets: MockSocket[] = [];
    let persistedConversationId = "";

    const runtime = new CopilotSessionRuntime(
      baseConfig,
      "session-1",
      undefined,
      (state) => {
        persistedConversationId = state.conversationId;
      },
      {
        fetchImpl: createFetchMock({ conversationId: "conv-1" }),
        webSocketFactory: () => {
          const socket = new MockSocket();
          sockets.push(socket);
          return socket as any;
        }
      }
    );

    const stream = await runtime.streamPrompt(model, "Hello", "token");
    const eventsPromise = collectEvents(stream);

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
      expect(sockets[0].sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send"
      ]);
    });

    expect(persistedConversationId).toBe("conv-1");

    sockets[0].emit("message", JSON.stringify({ event: "appendText", id: "1", text: "Hi" }));
    sockets[0].emit("message", JSON.stringify({ event: "done", id: "2" }));

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);
    expect(await stream.result()).toMatchObject({
      stopReason: "stop",
      content: [{ type: "text", text: "Hi" }]
    });
  });

  test("rejects a second in-flight request for the same session", async () => {
    const runtime = new CopilotSessionRuntime(
      { ...baseConfig, conversationId: "conv-1", clientSessionId: "client-1" },
      "session-1",
      undefined,
      () => {},
      {
        fetchImpl: createFetchMock()
      }
    );

    (runtime as any).inflight = true;
    const second = await runtime.streamPrompt(model, "Again", "token");

    const secondEvent = await second[Symbol.asyncIterator]().next();
    expect(secondEvent.value.type).toBe("error");
    expect(secondEvent.value.error.stopReason).toBe("error");
    expect(secondEvent.value.error.errorMessage).toMatch(/one in-flight request/);
  });

  test("emits aborted error when request is already aborted after bootstrap and before connect", async () => {
    const runtime = new CopilotSessionRuntime(
      baseConfig,
      "session-1",
      undefined,
      () => {},
      {
        fetchImpl: createFetchMock({ conversationId: "conv-1" }),
        webSocketFactory: () => {
          throw new Error("should not connect when aborted");
        }
      }
    );

    const abortController = new AbortController();
    abortController.abort();
    const stream = await runtime.streamPrompt(model, "Hello", "token", abortController.signal);

    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value.type).toBe("error");
    expect(first.value.reason).toBe("aborted");
    expect(first.value.error.stopReason).toBe("aborted");
    expect(first.value.error.errorMessage).toMatch(/aborted/i);
  });

  test("returns immediate auth error stream when token is missing", async () => {
    const runtime = new CopilotSessionRuntime(baseConfig, "session-1", undefined, () => {}, {
      fetchImpl: createFetchMock()
    });

    const stream = await runtime.streamPrompt(model, "Hello", "   ");
    const events = await collectEvents(stream);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("error");
    expect(events[0].error.errorMessage).toMatch(/not logged in/i);
  });

  test("does not persist or reset state when access token fingerprint is unchanged", async () => {
    const fingerprint = createHash("sha256").update("token").digest("hex").slice(0, 16);
    const persistCalls: any[] = [];
    const runtime = new CopilotSessionRuntime(
      baseConfig,
      "session-1",
      {
        version: 2,
        sessionId: "session-1",
        conversationId: "conv-1",
        clientSessionId: "client-1",
        accessTokenFingerprint: fingerprint,
        updatedAt: "2026-03-20T00:00:00.000Z"
      },
      (state) => {
        persistCalls.push(state);
      },
      {
        fetchImpl: createFetchMock()
      }
    );

    await (runtime as any).prepareForAccessToken("token");
    expect(persistCalls).toHaveLength(0);
    expect(runtime.persistedState.conversationId).toBe("conv-1");
    expect(runtime.persistedState.clientSessionId).toBe("client-1");
  });

  test("maps a tool-aware Copilot JSON response into pi tool call events", async () => {
    let socket: MockSocket | undefined;
    const runtime = new CopilotSessionRuntime(
      { ...baseConfig, conversationId: "conv-1", clientSessionId: "client-1" },
      "session-1",
      undefined,
      () => {},
      {
        fetchImpl: createFetchMock(),
        webSocketFactory: () => {
          socket = new MockSocket();
          return socket as any;
        }
      }
    );

    const stream = await runtime.streamContext(
      model,
      {
        messages: [{ role: "user", content: "List the files in this repo.", timestamp: Date.now() }],
        tools: [
          {
            name: "ls",
            description: "List files in a directory",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" }
              }
            }
          } as any
        ]
      },
      undefined,
      "token"
    );

    const eventsPromise = collectEvents(stream);

    await waitFor(() => {
      expect(socket?.sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send"
      ]);
    });

    socket?.emit(
      "message",
      JSON.stringify({
        event: "appendText",
        id: "1",
        text: '{"responseType":"toolCalls","toolCalls":[{"name":"ls","arguments":{"path":"."}}]}'
      })
    );
    socket?.emit("message", JSON.stringify({ event: "done", id: "2" }));

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual(["start", "toolcall_start", "toolcall_end", "done"]);

    const result = await stream.result();
    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toMatchObject([{ type: "toolCall", name: "ls", arguments: { path: "." } }]);
  });

  test("retries once when a tool-aware turn completes with an empty response", async () => {
    let socket: MockSocket | undefined;
    const runtime = new CopilotSessionRuntime(
      { ...baseConfig, conversationId: "conv-1", clientSessionId: "client-1" },
      "session-1",
      undefined,
      () => {},
      {
        fetchImpl: createFetchMock(),
        webSocketFactory: () => {
          socket = new MockSocket();
          return socket as any;
        }
      }
    );

    const stream = await runtime.streamContext(
      model,
      {
        messages: [{ role: "user", content: "Analyze this repository.", timestamp: Date.now() }],
        tools: [
          {
            name: "ls",
            description: "List files in a directory",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" }
              }
            }
          } as any
        ]
      },
      undefined,
      "token"
    );

    const eventsPromise = collectEvents(stream);

    await waitFor(() => {
      expect(socket?.sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send"
      ]);
    });

    socket?.emit("message", JSON.stringify({ event: "done", id: "1" }));

    await waitFor(() => {
      expect(socket?.sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send",
        "messagePreview",
        "send"
      ]);
      const retryPayload = socket?.sent[4] as { content: Array<{ text: string }> };
      expect(retryPayload.content[0].text).toContain("The previous reply was empty.");
    });

    socket?.emit(
      "message",
      JSON.stringify({
        event: "appendText",
        id: "2",
        text: '{"responseType":"message","text":"Done."}'
      })
    );
    socket?.emit("message", JSON.stringify({ event: "done", id: "3" }));

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);

    const result = await stream.result();
    expect(result.stopReason).toBe("stop");
    expect(result.content).toMatchObject([{ type: "text", text: "Done." }]);
  });

  test("replays in a fresh conversation when repair hits too-many-messages", async () => {
    const sockets: MockSocket[] = [];
    const createdConversationIds: string[] = [];
    let conversationCounter = 1;

    const runtime = new CopilotSessionRuntime(
      { ...baseConfig, conversationId: "conv-1", clientSessionId: "client-1" },
      "session-1",
      undefined,
      () => {},
      {
        fetchImpl: createFetchMock({
          onConversationCreate: async () => {
            const conversationId = `conv-${++conversationCounter}`;
            createdConversationIds.push(conversationId);
            return new Response(JSON.stringify({ conversationId }), {
              status: 200,
              headers: { "content-type": "application/json" }
            });
          }
        }),
        webSocketFactory: () => {
          const socket = new MockSocket();
          sockets.push(socket);
          return socket as any;
        }
      }
    );

    const stream = await runtime.streamContext(
      model,
      {
        messages: [{ role: "user", content: "Analyze this repository.", timestamp: Date.now() }],
        tools: [
          {
            name: "ls",
            description: "List files in a directory",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" }
              }
            }
          } as any
        ]
      },
      undefined,
      "token"
    );

    const eventsPromise = collectEvents(stream);

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
      expect(sockets[0].sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send"
      ]);
    });

    sockets[0].emit("message", JSON.stringify({ event: "done", id: "1" }));

    await waitFor(() => {
      expect(sockets[0].sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send",
        "messagePreview",
        "send"
      ]);
    });

    sockets[0].emit("message", JSON.stringify({ event: "error", errorCode: "too-many-messages", id: "2" }));

    await waitFor(() => {
      expect(createdConversationIds).toEqual(["conv-2"]);
      expect(sockets).toHaveLength(2);
      expect(sockets[1].sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send"
      ]);
      const replayPayload = sockets[1].sent[2] as { content: Array<{ text: string }>; conversationId: string };
      expect(replayPayload.conversationId).toBe("conv-2");
      expect(replayPayload.content[0].text).not.toContain("\n\nREPAIR\n\n");
      expect(replayPayload.content[0].text).toContain("Analyze this repository.");
    });

    sockets[1].emit(
      "message",
      JSON.stringify({
        event: "appendText",
        id: "3",
        text: '{"responseType":"message","text":"Done."}'
      })
    );
    sockets[1].emit("message", JSON.stringify({ event: "done", id: "4" }));

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual(["start", "text_start", "text_delta", "text_end", "done"]);

    const result = await stream.result();
    expect(result.stopReason).toBe("stop");
    expect(result.content).toMatchObject([{ type: "text", text: "Done." }]);
  });

  test("retries once when a tool-aware turn returns invalid prose instead of JSON", async () => {
    let socket: MockSocket | undefined;
    const runtime = new CopilotSessionRuntime(
      { ...baseConfig, conversationId: "conv-1", clientSessionId: "client-1" },
      "session-1",
      undefined,
      () => {},
      {
        fetchImpl: createFetchMock(),
        webSocketFactory: () => {
          socket = new MockSocket();
          return socket as any;
        }
      }
    );

    const stream = await runtime.streamContext(
      model,
      {
        messages: [{ role: "user", content: "Analyze this repository.", timestamp: Date.now() }],
        tools: [
          {
            name: "read",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" }
              }
            }
          } as any
        ]
      },
      undefined,
      "token"
    );

    const eventsPromise = collectEvents(stream);

    await waitFor(() => {
      expect(socket?.sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send"
      ]);
    });

    socket?.emit("message", JSON.stringify({ event: "appendText", id: "1", text: "I will read package.json next." }));
    socket?.emit("message", JSON.stringify({ event: "done", id: "2" }));

    await waitFor(() => {
      expect(socket?.sent.map((payload) => payload.event)).toEqual([
        "setOptions",
        "reportLocalConsents",
        "messagePreview",
        "send",
        "messagePreview",
        "send"
      ]);
      const retryPayload = socket?.sent[4] as { content: Array<{ text: string }> };
      expect(retryPayload.content[0].text).toContain("not valid JSON");
      expect(retryPayload.content[0].text).toContain("I will read package.json next.");
    });

    socket?.emit(
      "message",
      JSON.stringify({
        event: "appendText",
        id: "3",
        text: '{"responseType":"toolCalls","toolCalls":[{"name":"read","arguments":{"path":"package.json"}}]}'
      })
    );
    socket?.emit("message", JSON.stringify({ event: "done", id: "4" }));

    const events = await eventsPromise;
    expect(events.map((event) => event.type)).toEqual(["start", "toolcall_start", "toolcall_end", "done"]);

    const result = await stream.result();
    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toMatchObject([{ type: "toolCall", name: "read", arguments: { path: "package.json" } }]);
  });
});
