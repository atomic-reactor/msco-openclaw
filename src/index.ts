import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildMicrosoftCopilotProvider } from "./provider.js";

export default definePluginEntry({
  id: "msco-openclaw",
  name: "Microsoft Copilot",
  description: "Microsoft Copilot provider plugin for OpenClaw",
  register(api) {
    api.registerProvider(buildMicrosoftCopilotProvider());
  },
});
