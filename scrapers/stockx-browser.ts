import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

type BrowserMode = "background" | "headless" | "visible";

interface Session {
  child?: ChildProcess;
  profile?: string;
  browser: Browser;
  context: BrowserContext;
  mode: BrowserMode;
}

let session: Session | undefined;
let startingSession: Promise<Session> | undefined;
let queue: Promise<void> = Promise.resolve();
let idleTimer: NodeJS.Timeout | undefined;
let shutdownHooksInstalled = false;
let activeOperations = 0;

const bundledChromiumVersion = "v153.0.0";

function browserMode(): BrowserMode {
  const mode = process.env.STOCKX_BROWSER_MODE ?? "headless";
  if (mode === "background" || mode === "headless" || mode === "visible") return mode;
  throw new Error("STOCKX_BROWSER_MODE must be background, headless, or visible");
}

function isNetlifyRuntime(): boolean {
  return process.env.NETLIFY === "true"
    || Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME)
    || Boolean(process.env.AWS_LAMBDA_JS_RUNTIME);
}

function activeBrowserMode(): BrowserMode {
  return isNetlifyRuntime() ? "headless" : browserMode();
}

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

function validatedGoatURL(value: string, templateId: number): URL {
  const url = new URL(value);
  if (url.origin !== "https://www.goat.com" || url.username || url.password
    || !/^\/sneakers\/[^/]+$/.test(url.pathname) || url.search || url.hash
    || !Number.isSafeInteger(templateId) || templateId <= 0) {
    throw new Error("GOAT browser only accepts public https://www.goat.com/sneakers/ product URLs and a positive template ID");
  }
  return url;
}

function validatedFlightClubURL(value: string): URL {
  const url = new URL(value);
  if (url.origin !== "https://www.flightclub.com" || url.username || url.password
    || !/^\/[a-z0-9][a-z0-9-]*$/.test(url.pathname) || url.search || url.hash) {
    throw new Error("Flight Club browser only accepts public https://www.flightclub.com/ product URLs");
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
  throw new Error("Public storefront prices require Chrome. Install Google Chrome or set STOCKX_CHROME_PATH to its executable.");
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
    if (current.child) await stopChild(current.child);
    if (current.profile) {
      await rm(current.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  process.once("beforeExit", () => { void stockXBrowser.close().catch(() => {}); });
  process.once("exit", () => {
    // Async work cannot finish during exit; this only touches our own child/profile.
    if (session) {
      session.child?.kill("SIGTERM");
      if (session.profile) rmSync(session.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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

async function headlessContext(browser: Browser): Promise<BrowserContext> {
  const control = await browser.newBrowserCDPSession();
  try {
    const { userAgent } = await control.send("Browser.getVersion");
    // The public storefronts reject the HeadlessChrome user-agent even when
    // Chrome can render them. Keep the actual browser version and platform.
    return await browser.newContext({
      userAgent: userAgent.replace("HeadlessChrome/", "Chrome/"),
      locale: "en-US",
    });
  } finally {
    await control.detach().catch(() => {});
  }
}

async function startSession(mode: BrowserMode): Promise<Session> {
  if (isNetlifyRuntime()) {
    const { default: bundledChromium } = await import("@sparticuz/chromium-min");
    const architecture = process.arch === "arm64" ? "arm64" : "x64";
    const packURL = process.env.CHROMIUM_PACK_URL
      ?? `https://github.com/Sparticuz/chromium/releases/download/${bundledChromiumVersion}/chromium-${bundledChromiumVersion}-pack.${architecture}.tar`;
    const executablePath = await bundledChromium.executablePath(packURL);
    const browser = await chromium.launch({
      args: bundledChromium.args,
      executablePath,
      headless: true,
    });
    try {
      const context = await headlessContext(browser);
      installShutdownHooks();
      return { browser, context, mode: "headless" };
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }
  const executable = await chromeExecutable();
  const profile = await mkdtemp(path.join(tmpdir(), "sneaks-stockx-chrome-"));
  const child = spawn(executable, [
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...(mode === "background" ? ["--no-startup-window"] : mode === "headless" ? ["--headless=new", "about:blank"] : ["about:blank"]),
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
    const context = mode === "headless" ? await headlessContext(browser) : browser.contexts()[0];
    if (!context) throw new Error("Chrome did not provide a browsing context");
    installShutdownHooks();
    return { child, profile, browser, context, mode };
  } catch (cause) {
    await browser?.close().catch(() => {});
    await stopChild(child);
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw new Error(`Could not start Chrome for public storefronts in ${mode} mode. Chrome must be installed; background and visible modes also require a graphical display.`, { cause });
  }
}

async function createPage(current: Session): Promise<Page> {
  if (current.mode !== "background") return current.context.newPage();
  const control = await current.browser.newBrowserCDPSession();
  try {
    // Create the window minimized from the start; opening a normal page first
    // would briefly steal focus before its window state could be changed.
    const [page] = await Promise.all([
      current.context.waitForEvent("page", { timeout: 10_000 }),
      control.send("Target.createTarget", {
        url: "about:blank", newWindow: true, background: true,
        focus: false, windowState: "minimized",
      }),
    ]);
    return page;
  } finally {
    await control.detach().catch(() => {});
  }
}

async function currentSession(): Promise<Session> {
  const mode = activeBrowserMode();
  if (session?.browser.isConnected() && (!session.child || childAlive(session.child)) && session.mode === mode) {
    return session;
  }
  if (startingSession) return startingSession;

  const previous = session;
  session = undefined;
  const operation = (async () => {
    if (previous) await dispose(previous);
    const next = await startSession(mode);
    session = next;
    return next;
  })();
  startingSession = operation;
  try {
    return await operation;
  } finally {
    if (startingSession === operation) startingSession = undefined;
  }
}

function runBrowserOperation<T>(run: () => Promise<T>): Promise<T> {
  const execute = async (): Promise<T> => {
    cancelIdleClose();
    activeOperations += 1;
    try {
      return await run();
    } finally {
      activeOperations -= 1;
      if (activeOperations === 0) {
        idleTimer = setTimeout(() => { void stockXBrowser.close().catch(() => {}); }, 30_000);
        idleTimer.unref();
      }
    }
  };
  if (isNetlifyRuntime()) return execute();

  const operation = queue.then(execute);
  queue = operation.then(() => {}, () => {});
  return operation;
}

async function readGoatPrices(url: URL, templateId: number): Promise<unknown> {
  const page = await createPage(await currentSession());
  try {
    // Observe the same public price response the storefront uses. Do not use
    // search-index quotes when the live storefront is unavailable.
    const prices = page.waitForResponse((response) => {
      const source = new URL(response.url());
      return source.origin === url.origin
        && source.pathname === "/web-api/v1/product_variants/buy_bar_data"
        && source.searchParams.get("productTemplateId") === String(templateId)
        && source.searchParams.get("countryCode") === "US";
    }, { timeout: 30_000 });
    // Attach a rejection handler immediately, even if navigation fails first.
    const outcome = prices.then(async (response) => {
      if (response.status() !== 200) throw new Error(`GOAT public price response returned HTTP ${response.status()}`);
      const data: unknown = await response.json();
      return data;
    });
    void outcome.catch(() => {});
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response || response.status() >= 400 || new URL(page.url()).origin !== url.origin) {
      throw new Error(`GOAT public product page failed (HTTP ${response?.status() ?? "no response"})`);
    }
    return await outcome;
  } finally {
    await page.close().catch(() => {});
  }
}

async function readFlightClubPage(url: URL): Promise<string> {
  const page = await createPage(await currentSession());
  try {
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response || response.status() >= 400 || new URL(page.url()).origin !== url.origin) {
      throw new Error(`Flight Club public product page failed (HTTP ${response?.status() ?? "no response"})`);
    }
    await page.waitForFunction(() => {
      const data = document.querySelector("#__NEXT_DATA__")?.textContent;
      if (!data) return false;
      try {
        const value: unknown = JSON.parse(data);
        if (typeof value !== "object" || value === null || !("props" in value)) return false;
        const props = value.props;
        if (typeof props !== "object" || props === null || !("pageProps" in props)) return false;
        const pageProps = props.pageProps;
        return typeof pageProps === "object" && pageProps !== null && "productTemplate" in pageProps;
      } catch { return false; }
    }, undefined, { timeout: 30_000 });
    return await page.content();
  } finally {
    await page.close().catch(() => {});
  }
}

async function readPage(url: URL): Promise<string> {
  const page = await createPage(await currentSession());
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
    return runBrowserOperation(() => readPage(url));
  },

  getGoatPrices(value: string, templateId: number): Promise<unknown> {
    let url: URL;
    try {
      url = validatedGoatURL(value, templateId);
    } catch (error) {
      return Promise.reject(error);
    }
    return runBrowserOperation(() => readGoatPrices(url, templateId));
  },

  getFlightClubPage(value: string): Promise<string> {
    let url: URL;
    try {
      url = validatedFlightClubURL(value);
    } catch (error) {
      return Promise.reject(error);
    }
    return runBrowserOperation(() => readFlightClubPage(url));
  },

  close(): Promise<void> {
    cancelIdleClose();
    const operation = queue.then(async () => {
      cancelIdleClose();
      while (activeOperations > 0) await delay(20);
      const current = session;
      session = undefined;
      if (current) await dispose(current);
    });
    queue = operation.then(() => {}, () => {});
    return operation;
  },
};

export default stockXBrowser;
