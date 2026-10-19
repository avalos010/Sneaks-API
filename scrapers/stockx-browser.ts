import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

interface Session {
  child: ChildProcess;
  profile: string;
  browser: Browser;
  context: BrowserContext;
}

let session: Session | undefined;
let queue: Promise<void> = Promise.resolve();
let idleTimer: NodeJS.Timeout | undefined;
let shutdownHooksInstalled = false;

function cancelIdleClose(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = undefined;
}

function validatedURL(value: string): URL {
  const url = new URL(value);
  if (url.origin !== "https://stockx.com" || url.username || url.password) {
    throw new Error("StockX browser only accepts public https://stockx.com URLs");
  }
  return url;
}

async function chromeExecutable(): Promise<string> {
  const configured = process.env.STOCKX_CHROME_PATH || process.env.CHROME_BIN;
  const candidates = configured ? [configured] : [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ...[process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA]
      .filter((directory): directory is string => Boolean(directory))
      .map((directory) => path.join(directory, "Google", "Chrome", "Application", "chrome.exe")),
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  for (const candidate of candidates) {
    try {
      await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return candidate;
    } catch {
      // Continue through known installation locations, never use a user's profile.
    }
  }
  throw new Error("StockX public pages require Chrome and a graphical display. Install Google Chrome or set STOCKX_CHROME_PATH to its executable.");
}

function childAlive(child: ChildProcess): boolean {
  return child.pid !== undefined && child.exitCode === null && child.signalCode === null;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (!childAlive(child)) return;
  child.kill("SIGTERM");
  const deadline = Date.now() + 3_000;
  while (childAlive(child) && Date.now() < deadline) await delay(50);
  if (childAlive(child)) {
    child.kill("SIGKILL");
    const killDeadline = Date.now() + 1_000;
    while (childAlive(child) && Date.now() < killDeadline) await delay(50);
  }
}

async function dispose(current: Session): Promise<void> {
  let closeTimer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      current.browser.close().catch(() => {}),
      new Promise<void>((resolve) => { closeTimer = setTimeout(resolve, 3_000); }),
    ]);
  } finally {
    if (closeTimer) clearTimeout(closeTimer);
    await stopChild(current.child);
    await rm(current.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  process.once("beforeExit", () => { void stockXBrowser.close().catch(() => {}); });
  process.once("exit", () => {
    // Async work cannot finish during exit; this only touches our own child/profile.
    if (session) {
      session.child.kill("SIGTERM");
      rmSync(session.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      void stockXBrowser.close().catch(() => {}).finally(() => {
        // Preserve normal signal termination when the host has no signal handler.
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    });
  }
}

async function startSession(): Promise<Session> {
  const executable = await chromeExecutable();
  const profile = await mkdtemp(path.join(tmpdir(), "sneaks-stockx-chrome-"));
  const child = spawn(executable, [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore" });
  let launchError: Error | undefined;
  child.once("error", (error: Error) => { launchError = error; });
  child.unref();
  let browser: Browser | undefined;
  try {
    const deadline = Date.now() + 15_000;
    let port: number | undefined;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (!childAlive(child)) throw new Error(`Chrome exited before startup (${child.exitCode ?? child.signalCode ?? "unknown"})`);
      try {
        const activePort = await readFile(path.join(profile, "DevToolsActivePort"), "utf8");
        const candidate = Number(activePort.split("\n")[0]);
        if (Number.isInteger(candidate) && candidate > 0 && candidate <= 65535) {
          port = candidate;
          break;
        }
      } catch {
        // Chrome writes this file once its local debugging endpoint is ready.
      }
      await delay(100);
    }
    if (!port) throw new Error("Chrome did not start its local debugging endpoint within 15 seconds");
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("Chrome did not provide a browsing context");
    installShutdownHooks();
    return { child, profile, browser, context };
  } catch (cause) {
    await browser?.close().catch(() => {});
    await stopChild(child);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw new Error("Could not start Chrome for StockX public pages. Chrome must be installed and a graphical display available.", { cause });
  }
}

async function readPage(url: URL): Promise<string> {
  if (!session?.browser.isConnected() || !childAlive(session.child)) {
    const previous = session;
    session = undefined;
    if (previous) await dispose(previous);
    session = await startSession();
  }
  const page = await session.context.newPage();
  try {
    page.setDefaultTimeout(30_000);
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response) throw new Error("StockX did not return a page response");
    if ([401, 403, 429].includes(response.status())) {
      throw new Error(`StockX blocked public browser access (HTTP ${response.status()}); no challenge or login will be attempted`);
    }
    if (response.status() >= 400) throw new Error(`StockX returned HTTP ${response.status()}`);
    if (new URL(page.url()).origin !== "https://stockx.com") {
      throw new Error("StockX redirected outside its public storefront");
    }
    if (url.pathname === "/search" || url.pathname.startsWith("/search/")) {
      await page.waitForSelector("#product-results", { state: "attached" });
      await page.waitForFunction(() => {
        if (document.querySelector('#product-results [data-testid="ProductTile"] a[href]')) return true;
        const text = document.querySelector("#main-content")?.textContent ?? "";
        return /\b(?:0 results|no results|no items found)\b/i.test(text);
      });
    } else {
      await page.waitForSelector('[data-component="product-trait"]', { state: "attached" });
      await page.waitForFunction(() => Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((element) => {
        try {
          const data: unknown = JSON.parse(element.textContent ?? "null");
          return typeof data === "object" && data !== null && "@type" in data && data["@type"] === "Product";
        } catch {
          return false;
        }
      }));
    }
    return await page.content();
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : "Unknown browser failure";
    throw new Error(`Could not read StockX public page '${url.pathname}': ${detail}`, { cause });
  } finally {
    await page.close().catch(() => {});
  }
}

const stockXBrowser = {
  getPage(value: string): Promise<string> {
    let url: URL;
    try {
      url = validatedURL(value);
    } catch (error) {
      return Promise.reject(error);
    }
    cancelIdleClose();
    const operation = queue.then(async () => {
      cancelIdleClose();
      try {
        return await readPage(url);
      } finally {
        idleTimer = setTimeout(() => { void stockXBrowser.close().catch(() => {}); }, 30_000);
        idleTimer.unref();
      }
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  },

  close(): Promise<void> {
    cancelIdleClose();
    const operation = queue.then(async () => {
      cancelIdleClose();
      const current = session;
      session = undefined;
      if (current) await dispose(current);
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  },
};

export default stockXBrowser;
