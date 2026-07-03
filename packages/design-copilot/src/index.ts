import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerIconTool } from "./icons.js";
import { registerAssetTool } from "./assets.js";
import { registerBriefGate } from "./brief.js";
import { registerReviewGate } from "./review.js";

export default function designCopilotExtension(pi: ExtensionAPI): void {
  registerIconTool(pi);
  registerAssetTool(pi);
  registerBriefGate(pi);
  registerReviewGate(pi);
}
