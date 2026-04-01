import EventEmitter from "node:events";
import WebSocket from "ws";
import { describe, expect, test } from "vitest";
import { CopilotWebSocketClient } from "../src/transport/websocket-client.js";
import type { CopilotRequestConfig } from "../src/types.js";

class FailingSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING as unknown as number;
  send(): void {}
  close(): void {}
}

const requestConfig: CopilotRequestConfig = {
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

describe("websocket client", () => {
  test("rejects connect when socket closes before opening", async () => {
    const socket = new FailingSocket();
    const client = new CopilotWebSocketClient(requestConfig, "client-1", () => socket as any);
    const connectPromise = client.connect();
    socket.emit("close", 1006, Buffer.from("abnormal"));
    await expect(connectPromise).rejects.toThrow(/closed before opening/i);
  });
});
