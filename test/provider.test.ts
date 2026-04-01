import { describe, expect, test } from "vitest";
import {
  PROVIDER_MODELS,
  buildMicrosoftCopilotProvider,
  resolveCopilotMode
} from "../src/provider.js";

describe("provider", () => {
  test("registers a single Copilot model", () => {
    expect(PROVIDER_MODELS).toHaveLength(1);
    expect(PROVIDER_MODELS[0]).toMatchObject({
      id: "copilot",
      name: "Microsoft Copilot",
      reasoning: true
    });
  });

  test("maps pi thinking levels to Copilot modes", () => {
    expect(resolveCopilotMode("off")).toBe("smart");
    expect(resolveCopilotMode("minimal")).toBe("smart");
    expect(resolveCopilotMode("low")).toBe("smart");
    expect(resolveCopilotMode("medium")).toBe("reasoning");
    expect(resolveCopilotMode("high")).toBe("reasoning");
    expect(resolveCopilotMode("xhigh")).toBe("reasoning");
    expect(resolveCopilotMode(undefined)).toBe("smart");
  });

  test("custom token auth flow persists token credential shape", async () => {
    const provider = buildMicrosoftCopilotProvider();
    const tokenAuth = provider.auth[0];
    const result = await tokenAuth.run({
      prompter: {
        text: async () => "  copilot-access-token  "
      }
    } as any);

    expect(result).toMatchObject({
      defaultModel: "microsoft-copilot/copilot",
      profiles: [
        {
          profileId: "microsoft-copilot:default",
          credential: {
            type: "token",
            provider: "microsoft-copilot",
            token: "copilot-access-token"
          }
        }
      ]
    });
    const credential = result.profiles[0]?.credential as { expires?: number };
    expect(typeof credential.expires).toBe("number");
    expect(credential.expires as number).toBeGreaterThan(Date.now());
  });

  test("missing auth guidance string points to provider login command", () => {
    const provider = buildMicrosoftCopilotProvider();
    expect(provider.buildMissingAuthMessage()).toBe(
      "Microsoft Copilot token missing. Run `openclaw models auth login --provider microsoft-copilot`."
    );
  });

  test("default thinking level aligns with reasoning mode fallback", () => {
    const provider = buildMicrosoftCopilotProvider();
    expect(provider.resolveDefaultThinkingLevel()).toBe("medium");
    expect(resolveCopilotMode(provider.resolveDefaultThinkingLevel())).toBe("reasoning");
  });

  test("unknown model hint enforces single-model policy", () => {
    const provider = buildMicrosoftCopilotProvider();
    expect(provider.buildUnknownModelHint()).toContain(
      "Use microsoft-copilot/copilot for this provider (single-model v1)."
    );
  });

  test("token auth rejects empty tokens after trimming", async () => {
    const provider = buildMicrosoftCopilotProvider();
    const tokenAuth = provider.auth[0];

    await expect(
      tokenAuth.run({
        prompter: {
          text: async () => "   "
        }
      } as any)
    ).rejects.toThrow("A Microsoft Copilot access token is required");
  });

  test("prepareRuntimeAuth trims runtime api keys and rejects missing values", async () => {
    const provider = buildMicrosoftCopilotProvider();

    await expect(provider.prepareRuntimeAuth({ apiKey: "  runtime-token  " })).resolves.toMatchObject({
      apiKey: "runtime-token",
      baseUrl: "https://copilot.microsoft.com/c/api"
    });
    await expect(provider.prepareRuntimeAuth({ apiKey: "   " })).rejects.toThrow(
      "Microsoft Copilot access token is missing."
    );
  });

  test("catalog is compatible with env-backed api key resolution", async () => {
    const provider = buildMicrosoftCopilotProvider();
    const catalog = await provider.catalog.run({
      resolveProviderApiKey: () => ({ apiKey: " env-token " })
    });

    expect(catalog).toMatchObject({
      provider: {
        api: "openai-completions",
        baseUrl: "https://copilot.microsoft.com/c/api",
        apiKey: "env-token"
      }
    });
    expect(catalog?.provider.models).toHaveLength(1);
  });

  test("catalog returns null when no provider token is resolved", async () => {
    const provider = buildMicrosoftCopilotProvider();
    const catalog = await provider.catalog.run({
      resolveProviderApiKey: () => ({ apiKey: "   " })
    });

    expect(catalog).toBeNull();
  });

  test("catalog can resolve legacy oauth profile via resolveProviderAuth", async () => {
    const provider = buildMicrosoftCopilotProvider();
    const catalog = await provider.catalog.run({
      resolveProviderApiKey: () => ({ apiKey: "" }),
      resolveProviderAuth: () => ({ discoveryApiKey: " legacy-oauth-token " }),
    });

    expect(catalog).toMatchObject({
      provider: {
        apiKey: "legacy-oauth-token",
      },
    });
  });

});
