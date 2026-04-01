import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { ThinkingLevel } from "@mariozechner/pi-ai";
import type {
  ProviderAuthContext,
  ProviderAuthResult,
} from "openclaw/plugin-sdk/plugin-entry";
import { loadConfig, maskConfigForLog } from "./core/config.js";
import type { CopilotMode } from "./types.js";
import { CopilotRuntimeManager } from "./runtime/runtime-manager.js";
import { CopilotSessionStore } from "./runtime/session-store.js";

const PROVIDER_ID = "microsoft-copilot";
const MODEL_ID = "copilot";
const API_ID = "microsoft-copilot-chat";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 365 * 10;
const BASE_URL = "https://copilot.microsoft.com/c/api";

export const PROVIDER_MODELS = [
  {
    id: MODEL_ID,
    name: "Microsoft Copilot",
    api: API_ID,
    reasoning: true,
    input: ["text"] as const,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
  },
];

const sessionStore = new CopilotSessionStore();
const runtimeManager = new CopilotRuntimeManager(
  loadConfig(),
  (sessionId) => sessionStore.get(sessionId),
  (state) => sessionStore.set(state),
);

function buildProfileId(): string {
  return `${PROVIDER_ID}:default`;
}

async function runTokenAuth(ctx: ProviderAuthContext): Promise<ProviderAuthResult> {
  const token = (
    await ctx.prompter.text({
      message: "Paste your Microsoft Copilot access token",
      validate: (value) => (value.trim() ? undefined : "Access token is required"),
    })
  ).trim();

  if (!token) {
    throw new Error("A Microsoft Copilot access token is required");
  }

  return {
    profiles: [
      {
        profileId: buildProfileId(),
        credential: {
          type: "token",
          provider: PROVIDER_ID,
          token,
          expires: Date.now() + TOKEN_TTL_MS,
        },
      },
    ],
    defaultModel: `${PROVIDER_ID}/${MODEL_ID}`,
    notes: [
      "Token-only auth is currently supported for Microsoft Copilot.",
      "You can re-run auth anytime to replace the stored token.",
    ],
  };
}

function resolveSessionId(): string {
  return "openclaw-default-session";
}

function buildStreamFn(): StreamFn {
  return (model, context, options) => {
    const sessionId =
      typeof (options as { sessionId?: unknown })?.sessionId === "string"
        ? ((options as { sessionId?: string }).sessionId as string)
        : resolveSessionId();
    const reasoning = ((options as { reasoning?: ThinkingLevel | "off"; thinkingLevel?: ThinkingLevel | "off" })
      ?.reasoning ??
      (options as { reasoning?: ThinkingLevel | "off"; thinkingLevel?: ThinkingLevel | "off" })
        ?.thinkingLevel) as ThinkingLevel | "off" | undefined;

    // OpenClaw custom provider stream functions receive plain prompts via streamSimple
    // and full contexts via stream; route both paths explicitly.
    if (typeof context === "string") {
      return runtimeManager.streamSimple(
        sessionId,
        model as any,
        context,
        (options as { apiKey?: string | undefined })?.apiKey,
        options?.signal,
      ) as any;
    }

    return runtimeManager.streamContext(
      sessionId,
      model as any,
      context as any,
      resolveCopilotMode(reasoning),
      (options as { apiKey?: string | undefined })?.apiKey,
      options?.signal,
    ) as any;
  };
}

export function resolveCopilotMode(reasoning: ThinkingLevel | "off" | undefined): CopilotMode | undefined {
  if (!reasoning || reasoning === "off") {
    return "smart";
  }
  if (reasoning === "minimal" || reasoning === "low") {
    return "smart";
  }
  return "reasoning";
}

export function buildMicrosoftCopilotProvider() {
  const config = loadConfig();
  return {
    id: PROVIDER_ID,
    label: "Microsoft Copilot",
    docsPath: "/providers/models",
    envVars: ["MICROSOFT_COPILOT_ACCESS_TOKEN"],
    auth: [
      {
        id: "token",
        label: "Access token",
        hint: "Paste a Microsoft Copilot access token",
        kind: "custom" as const,
        run: runTokenAuth,
      },
    ],
    wizard: {
      setup: {
        choiceId: PROVIDER_ID,
        choiceLabel: "Microsoft Copilot",
        choiceHint: "Token-based Microsoft Copilot chat access",
        groupId: "copilot",
        groupLabel: "Copilot",
        groupHint: "Microsoft and GitHub Copilot providers",
        methodId: "token",
      },
    },
    catalog: {
      order: "late" as const,
      run: async (ctx: any) => {
        let key = ctx.resolveProviderApiKey(PROVIDER_ID).apiKey?.trim();
        if (!key && typeof ctx.resolveProviderAuth === "function") {
          const auth = ctx.resolveProviderAuth(PROVIDER_ID, {
            oauthMarker: "__microsoft_copilot_profile__",
          });
          key = auth?.discoveryApiKey?.trim();
        }
        if (!key) {
          return null;
        }
        return {
          provider: {
            api: API_ID,
            baseUrl: BASE_URL,
            apiKey: key,
            models: PROVIDER_MODELS as any,
          } as any,
        };
      },
    },
    createStreamFn: () => buildStreamFn(),
    buildMissingAuthMessage: () =>
      "Microsoft Copilot token missing. Run `openclaw models auth login --provider microsoft-copilot`.",
    prepareRuntimeAuth: async (ctx: any) => {
      const token = ctx.apiKey?.trim();
      if (!token) {
        throw new Error("Microsoft Copilot access token is missing.");
      }
      return {
        apiKey: token,
        baseUrl: BASE_URL,
      };
    },
    resolveDefaultThinkingLevel: () => "low" as const,
    buildUnknownModelHint: () =>
      "Use microsoft-copilot/copilot for this provider (single-model v1).",
    normalizeConfig: ({ providerConfig }: any) => {
      if (!providerConfig) {
        return providerConfig;
      }
      return {
        ...providerConfig,
        api: API_ID,
        baseUrl: providerConfig.baseUrl ?? BASE_URL,
      };
    },
    prepareExtraParams: ({ extraParams }: any) => ({ ...extraParams }),
    capabilities: {
      providerFamily: "openai" as const,
    },
    buildAuthDoctorHint: async () =>
      `Verify MICROSOFT_COPILOT_ACCESS_TOKEN and retry auth.\nLoaded config: ${JSON.stringify(
        maskConfigForLog(config),
      )}`,
  };
}
