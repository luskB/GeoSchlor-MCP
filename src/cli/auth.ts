import { BrowserSessionManager } from "../browser/session-manager.js";
import { loadConfig } from "../config.js";
import { SourceId } from "../types.js";

const source = (process.argv[2] ?? "").trim() as SourceId | "";
if (
  source !== "cnki" &&
  source !== "geophysics" &&
  source !== "wanfang" &&
  source !== "vip"
) {
  process.stderr.write("Usage: npm run auth -- <cnki|geophysics|wanfang|vip>\n");
  process.exit(1);
}

const config = loadConfig();
const browser = new BrowserSessionManager(config);

const startUrl =
  source === "cnki"
    ? "https://www.cnki.net/"
    : source === "geophysics"
      ? "https://pubs.geoscienceworld.org/seg/geophysics"
      : source === "wanfang"
        ? "https://www.wanfangdata.com.cn/"
        : "https://www.cqvip.com/";

try {
  const path = await browser.bootstrap(source, startUrl);
  process.stdout.write(`Saved ${source} browser state to ${path}\n`);
} catch (error) {
  const message =
    error instanceof Error ? error.message : `Unknown error while bootstrapping ${source}`;
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
