import { describe, expect, test, vi } from "vitest";
import { CopilotConversationService } from "../src/transport/conversation-service.js";
import type { CopilotRequestConfig } from "../src/types.js";

const requestConfig: CopilotRequestConfig = {
  accessToken: "token",
  cookie: "k=v",
  mode: "reasoning",
  channel: "edge",
  apiVersion: "2",
  debug: false,
  trace: false,
  origin: "https://copilot.microsoft.com",
  userAgent: "test-agent"
};

describe("conversation service", () => {
  test("creates conversation and parses nested id shapes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/c/api/conversations")) {
        return new Response(JSON.stringify({ conversation: { id: "conv-nested" } }), { status: 200 });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const service = new CopilotConversationService(requestConfig, fetchMock as typeof fetch);
    await expect(service.createConversation()).resolves.toBe("conv-nested");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("falls back to default server config when fetch fails and caches result", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });

    const service = new CopilotConversationService(requestConfig, fetchMock as typeof fetch);
    await expect(service.getServerConfig()).resolves.toMatchObject({ maxTextMessageLength: 10240 });
    await expect(service.getServerConfig()).resolves.toMatchObject({ maxTextMessageLength: 10240 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
