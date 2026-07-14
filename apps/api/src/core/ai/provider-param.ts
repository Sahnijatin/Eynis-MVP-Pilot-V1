// Reads the optional ?provider= query param for AI endpoints (claude default).
import type { AIProvider } from "./intelligence";
import { parseUrl } from "../../http/helpers";

export const parseAIProvider = (url: string | undefined): AIProvider => {
  const p = parseUrl(url).searchParams.get("provider");
  return p === "openai" ? "openai" : "claude";
};
