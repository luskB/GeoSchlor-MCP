import { AppConfig } from "../config.js";

const DEFAULT_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36 Edg/146.0.0.0";

export function getBrowserCompatibleUserAgent(
  config: Pick<AppConfig, "browserUserAgent">
): string {
  return config.browserUserAgent ?? DEFAULT_BROWSER_USER_AGENT;
}

export function buildBrowserCompatibleHeaders(
  config: Pick<AppConfig, "browserUserAgent">,
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    "user-agent": getBrowserCompatibleUserAgent(config),
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    ...overrides
  };
}
