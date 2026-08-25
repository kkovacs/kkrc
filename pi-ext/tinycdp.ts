// tinycdp.ts — minimal Chrome DevTools Protocol extension for pi (one file)
//
// Connects lazily to ONE tab (created by us, never closed), exposes three
// tools: navigate, evaluate, screenshot. Everything else is doable via JS.
//
// Self-contained: the minimal dep-free CDP client is inlined below (it uses
// only global WebSocket/fetch/AbortSignal) so both this extension and the
// standalone self-test (tinycdp.test.ts) can reuse it without pulling any
// extra dependencies into the test.
//
// Usage: pi -e tinycdp.ts [--cdp-url http://host:port] [--no-screenshot]
//
// You can test this with:
// pi -p -e pi-ext/tinycdp.ts --tools cdp_navigate,cdp_evaluate --model opencode-go/mimo-v2.5 'Please navigate to kkovacs.eu, and output the name of the guy!'
// The expected result is "Kristof Kovacs".
//
// You can start a docker-based Chrome with: sudo docker run -u `id -u user` -it --rm --add-host host.docker.internal:host-gateway -p 9222:9222 chromedp/headless-shell:latest --no-sandbox --disable-web-security --disable-site-isolation-trials --window-size=1280,720

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Text } from "@earendil-works/pi-tui";

// --- minimal CDP client (inlined from cdp-client.ts; dep-free) --------------

export interface Conn {
    send: (method: string, params?: object) => Promise<any>;
    // resolve on the frame's load/network-idle lifecycle (immediately if it
    // already fired); correlates by frame, not by URL string
    waitLoad: (frameId: string | undefined, timeoutMs?: number) => Promise<void>;
    // drop a frame's tracked lifecycle so a stale `load` from the previous page
    // can't satisfy the next navigation (called right before Page.navigate)
    resetFrame: (frameId: string) => void;
    close: () => void;
    closeTarget: () => Promise<void>;
}

// --- shared connection state ------------------------------------------------
// connP caches the live connection. socketDropped is set when an *established*
// socket closes (Chrome restart/crash); browserGone is set when a reconnect
// attempt after a drop also fails, at which point we fail fast.
let connP: Promise<Conn> | undefined;
let socketDropped = false;
let browserGone = false;

export async function connect(baseUrl: string): Promise<Conn> {
    const res = await fetch(`${baseUrl}/json/version`);
    const { webSocketDebuggerUrl } = await res.json();

    let id = 0;
    const pending = new Map<
        number,
        { resolve: (v: any) => void; reject: (e: Error) => void }
    >();

    // latest lifecycle event per frame — maintained for the connection's whole
    // lifetime so a load that fired before waitLoad attached its listener is
    // still visible (this is what eliminates the listener-attach race)
    const lifecycle = new Map<string, { name: string; loaderId?: string }>();

    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise<void>((ok, err) => {
        ws.onopen = ok;
        ws.onerror = () => err(new Error("CDP websocket error"));
    });

    ws.onmessage = (ev) => {
        let msg: any;
        try {
            msg = JSON.parse(ev.data);
        } catch {
            return; // malformed frame: ignore it rather than kill the dispatch loop
        }
        if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id)!;
            pending.delete(msg.id);
            msg.error
                ? p.reject(new Error(msg.error.message))
                : p.resolve(msg.result);
        } else if (msg.method === "Page.javascriptDialogOpening") {
            // a JS dialog blocks the renderer's main thread; auto-dismiss so
            // evaluate/navigate don't hang. Fire-and-forget: no pending tracked.
            ws.send(
                JSON.stringify({
                    id: ++id,
                    method: "Page.handleJavaScriptDialog",
                    params: { accept: false },
                    sessionId,
                }),
            );
        } else if (msg.method === "Page.lifecycleEvent") {
            // track the latest lifecycle transition per frame (load, networkIdle,
            // etc.) so waitLoad can resolve the moment it happens — or realise
            // it already happened — without a per-call listener race
            const p = msg.params ?? {};
            lifecycle.set(p.frameId, { name: p.name, loaderId: p.loaderId });
        } else if (msg.method === "Page.frameNavigated") {
            const p = msg.params ?? {};
            if (p.frame?.loaderId)
                lifecycle.set(p.frame.frameId, {
                    name: "frameNavigated",
                    loaderId: p.frame.loaderId,
                });
        }
    };

    const raw = (msg: object) =>
        new Promise<any>((resolve, reject) => {
            pending.set(++id, { resolve, reject });
            ws.send(JSON.stringify({ id, ...msg }));
        });

    // create and attach to exactly one tab
    const { targetId } = await raw({
        method: "Target.createTarget",
        params: { url: "about:blank" },
    });
    const { sessionId } = await raw({
        method: "Target.attachToTarget",
        params: { targetId, flatten: true },
    });
    await raw({ method: "Page.enable", sessionId });
    await raw({ method: "Runtime.enable", sessionId });
    // emit Page.lifecycleEvent for every load/DOMContentLoaded/networkIdle
    // transition (needed by waitLoad)
    await raw({ method: "Page.setLifecycleEventsEnabled", params: { enabled: true }, sessionId });

    // If the socket drops after a successful connection (Chrome restart/crash),
    // invalidate the cache so the next tool call attempts to re-establish; if that
    // reconnect also fails, cdp() marks the browser gone and fails fast.
    ws.onclose = () => {
        if (connP) {
            connP = undefined;
            socketDropped = true;
        }
    };

    return {
        send: (method, params = {}) => raw({ method, params, sessionId }),
        // Resolve when the target frame reaches `load` / `networkIdle`. Because
        // lifecycle events are tracked from connect time, a transition that
        // already happened is seen immediately (no listener-attach race), and
        // resetFrame() before navigate ensures a stale load from the previous
        // page can't satisfy the new navigation.
        waitLoad: (
            frameId: string | undefined,
            timeoutMs = 30000,
        ): Promise<void> =>
            new Promise<void>((resolve, reject) => {
                const matches = (l?: { name: string; loaderId?: string }) =>
                    !!l &&
                    (l.name === "load" ||
                        l.name === "networkIdle" ||
                        l.name === "networkAlmostIdle");

                const finish = (timedOut: boolean) => {
                    clearTimeout(timer);
                    ws.removeEventListener("message", onEvent);
                    timedOut
                        ? reject(new Error("timeout waiting for page load"))
                        : resolve();
                };

                const timer = setTimeout(() => finish(true), timeoutMs);

                const onEvent = (ev: MessageEvent) => {
                    let msg: any;
                    try {
                        msg = JSON.parse(ev.data);
                    } catch {
                        return;
                    }
                    if (msg?.method === "Page.lifecycleEvent") {
                        const p = msg.params ?? {};
                        lifecycle.set(p.frameId, {
                            name: p.name,
                            loaderId: p.loaderId,
                        });
                        if (
                            p.frameId === frameId &&
                            matches(lifecycle.get(frameId as string))
                        )
                            finish(false);
                    }
                };
                ws.addEventListener("message", onEvent);

                // already loaded for this frame? resolve now — kills the race
                // for fast pages that finished before we could listen
                if (matches(lifecycle.get(frameId as string))) finish(false);
            }),

        resetFrame: (frameId: string) => {
            lifecycle.delete(frameId);
        },
        close: () => ws.close(),
        // browser-level command, no session id
        closeTarget: () =>
            raw({ method: "Target.closeTarget", params: { targetId } }),
    };
}

// reject on user abort and/or a hard timeout — never let a wedged renderer
// block the main thread indefinitely (CDP calls are never truly cancellable)
export const guard = <T>(
    p: Promise<T>,
    opt: { signal?: AbortSignal; ms?: number; what?: string } = {},
): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const clearTimer = () => {
            if (timer) {
                clearTimeout(timer);
                timer = undefined;
            }
        };
        const onAbort = () =>
            settle(() => reject(new Error("cancelled by user")));
        const removeAbort = () => {
            if (opt.signal) opt.signal.removeEventListener("abort", onAbort);
        };
        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimer();
            removeAbort();
            fn();
        };
        opt.signal?.addEventListener("abort", onAbort, { once: true });
        if (opt.ms != null)
            timer = setTimeout(
                () =>
                    settle(() =>
                        reject(
                            new Error(
                                `${opt.what ?? "operation"} timed out after ${opt.ms}ms`,
                            ),
                        ),
                    ),
                opt.ms,
            );
        p.then(
            (v) => settle(() => resolve(v)),
            (e) => settle(() => reject(e)),
        );
    });

// one-line renderCall showing what the tool is about to do
const callLine =
    (label: string, detail?: (args: any) => string) =>
    (args: any, theme: any) => {
        let d = detail ? detail(args) : "";
        if (d.length > 120) d = d.slice(0, 117) + "...";
        return new Text(
            theme.fg("toolTitle", theme.bold(label)) +
                theme.fg("accent", d ? " " + d : ""),
            0,
            0,
        );
    };

// reset on failure so a transient "browser down" doesn't poison every later call.
// If an *established* socket later drops (Chrome restart/crash), socketDropped is
// set by connect()'s onclose; the next call tries to re-establish, and if that also
// fails we mark the browser gone and fail fast with a clear "browser went away" error.
const cdp = (pi: ExtensionAPI): Promise<Conn> => {
    const url = pi.getFlag("cdp-url") as string;
    // already determined the browser is gone: fail fast without another attempt
    if (browserGone)
        return Promise.reject(
            new Error(`browser went away — Chrome at ${url} is not reachable`),
        );
    return (connP ??= connect(url).then(
        (c) => {
            socketDropped = false; // re-established (or first connect) — clear the flag
            return c;
        },
        (e) => {
            connP = undefined;
            if (socketDropped) {
                browserGone = true;
                throw new Error(
                    `browser went away — Chrome at ${url} is not reachable`,
                );
            }
            throw e; // initial connect never succeeded: surface the original reason
        },
    ));
};

// tab deliberately survives pi (user requirement); socket dies with process
// on a dropped socket the next call re-establishes (or fails fast if Chrome is gone)

const fail = (e: unknown) => ({
    content: [
        {
            type: "text" as const,
            text: e instanceof Error ? e.message : String(e),
        },
    ],
    isError: true,
    details: {},
});

const text = (t: string) => ({
    content: [{ type: "text" as const, text: t }],
    details: {},
});

// --- extension ---------------------------------------------------------------

export default function (pi: ExtensionAPI) {
    // Always release the websocket so print mode (-p) can exit; close our tab only on a
    // real quit. On /new, /resume or /fork the page survives in Chrome, but connect()
    // always creates a fresh target, so the next call reconnects to Chrome and attaches
    // to a brand-new tab (the survived page is orphaned, not re-attached). browserGone is
    // also cleared here so a later call can attempt to re-establish if Chrome had dropped.
    pi.on("session_shutdown", (event) => {
        const p = connP;
        connP = undefined;
        socketDropped = false;
        browserGone = false;
        p?.then((c) =>
            (event.reason === "quit"
                ? c.closeTarget()
                : Promise.resolve()
            ).finally(() => c.close()),
        ).catch(() => {});
    });

    pi.registerFlag("cdp-url", {
        description: "CDP endpoint base URL",
        type: "string",
        default: "http://127.0.0.1:9222",
    });
    pi.registerFlag("no-screenshot", {
        description: "Disable the cdp_screenshot tool (enabled by default)",
        type: "boolean",
        default: false,
    });
    pi.registerFlag("cdp-timeout", {
        description: "Timeout in ms for page evaluation calls",
        type: "number",
        default: 30000,
    });

    pi.registerTool({
        name: "cdp_navigate",
        label: "CDP Navigate",
        description:
            "Navigate the browser tab to a URL and wait for the page to load. " +
            "Fails with the reason if the page cannot be reached.",
        parameters: Type.Object({
            url: Type.String({ description: "URL to navigate to" }),
        }),
        renderCall: callLine("cdp_navigate", (a) => a.url),
        executionMode: "sequential", // one shared tab: parallel calls would race
        async execute(_id, params, signal) {
            const a = <T>(p: Promise<T>) => guard(p, { signal });
            try {
                const c = await a(cdp(pi));
                // learn the main frame id, then forget its prior lifecycle so a
                // stale load from the previous page can't satisfy this nav
                const tree = await a(c.send("Page.getFrameTree")).catch(
                    () => undefined,
                );
                const frameId = (tree?.frameTree?.frame?.id ??
                    undefined) as string | undefined;
                if (frameId) c.resetFrame(frameId);
                const nav = await a(
                    c.send("Page.navigate", { url: params.url }),
                );
                // Chrome reports network-level failures here instead of throwing
                if (nav.errorText)
                    return fail(
                        new Error(`navigation failed: ${nav.errorText}`),
                    );
                // wait for the frame's load/network-idle lifecycle; resolves
                // immediately if it already fired (no race). We don't fail on
                // timeout here — the probe below decides what actually landed.
                await a(
                    c.waitLoad(frameId ?? (nav.frameId as string | undefined)),
                ).then(
                    () => undefined,
                    () => undefined,
                );
                // verify what actually landed, whether or not we hit the timeout
                const probe = await a(
                    c.send("Runtime.evaluate", {
                        expression:
                            "location.href + '\\u0000' + document.readyState",
                        returnByValue: true,
                    }),
                ).catch(() => undefined);
                const [href = "", state = ""] = String(
                    probe?.result?.value ?? "",
                ).split("\u0000");
                // a failed load swaps in Chrome's error page, which still fires load
                if (href.startsWith("chrome-error://"))
                    return fail(
                        new Error(
                            `could not load ${params.url} (Chrome error page)`,
                        ),
                    );
                if (state === "interactive" || state === "complete")
                    return text(`navigated to ${params.url}`);
                // not (yet) interactive: press the browser's "stop" button to free
                // the page's main thread, then confirm the renderer still answers
                await a(c.send("Page.stopLoading"));
                // be skeptical: stopLoading cancels network activity but cannot
                // interrupt scripts already running; verify the renderer actually
                // responds before declaring the partial page usable
                const alive = await a(
                    guard(
                        c.send("Runtime.evaluate", {
                            expression: "1",
                            returnByValue: true,
                        }),
                        { ms: 5000, what: "renderer responsiveness check" },
                    ).then(
                        () => true,
                        () => false,
                    ),
                );
                if (!alive)
                    return fail(
                        new Error(
                            `navigated to ${params.url}, but the page is still loading and its main thread is not responding ` +
                                `(a script on the partial page appears wedged); try again or use a lighter URL/mirror`,
                        ),
                    );
                return text(
                    `navigated to ${params.url} (still loading — stopped loading; partial page is usable)`,
                );
            } catch (e) {
                return fail(e);
            }
        },
    });

    pi.registerTool({
        name: "cdp_evaluate",
        label: "CDP Evaluate",
        description:
            "Evaluate a JavaScript expression in the page and return its JSON-stringified value. " +
            "If the expression returns a Promise, the result is awaited — use this to wait for async UI, " +
            "e.g. new Promise(r => setTimeout(() => r(document.body.innerText), 2000)).",
        parameters: Type.Object({
            expression: Type.String({
                description: "JavaScript to evaluate in page context",
            }),
        }),
        renderCall: callLine("cdp_evaluate", (a) =>
            a.expression.replace(/\s+/g, " "),
        ),
        executionMode: "sequential",
        async execute(_id, params, signal) {
            try {
                const a = <T>(p: Promise<T>) => guard(p, { signal });
                const c = await a(cdp(pi));
                const r = await a(
                    guard(
                        c.send("Runtime.evaluate", {
                            expression: params.expression,
                            returnByValue: true,
                            awaitPromise: true,
                        }),
                        {
                            ms: pi.getFlag("cdp-timeout") as number,
                            what: "cdp_evaluate",
                        },
                    ),
                );
                if (r.exceptionDetails) {
                    return text(
                        r.exceptionDetails.exception?.description ??
                            r.exceptionDetails.text,
                    );
                }
                return text(
                    JSON.stringify(r.result?.value) ??
                        r.result?.description ??
                        "undefined",
                );
            } catch (e) {
                // a timeout usually means the renderer's main thread is wedged by a runaway
                // script — interrupt it so the tab (and future calls) become usable again
                if (e instanceof Error && e.message.includes("timed out")) {
                    try {
                        (await cdp(pi))
                            .send("Runtime.terminateExecution")
                            .catch(() => {});
                    } catch {}
                }
                return fail(e);
            }
        },
    });

    // screenshot tool is available by default; opt out with --no-screenshot
    const screenshotTool = {
        name: "cdp_screenshot",
        label: "CDP Screenshot",
        description:
            "Capture a screenshot of the CDP browser tab's current viewport and receive it as an image. " +
            "Navigate first with cdp_navigate — capturing before any navigation yields a blank page.",
        promptSnippet: "Capture what the browser tab currently looks like",
        parameters: Type.Object({
            format: Type.Optional(
                Type.Union([Type.Literal("png"), Type.Literal("jpeg")], {
                    description: "Image format (default png)",
                }),
            ),
        }),
        renderCall: callLine("cdp_screenshot", (a) => a.format ?? "png"),
        executionMode: "sequential",
        async execute(_id, params, signal) {
            try {
                const a = <T>(p: Promise<T>) => guard(p, { signal });
                const c = await a(cdp(pi));
                const format = params.format ?? "png";
                // NOTE: pi expects ImageContent as { type: "image", data, mimeType } —
                // NOT the Anthropic-style { source: { data, mediaType } } shape
                const shot = await a(
                    guard(c.send("Page.captureScreenshot", { format }), {
                        ms: pi.getFlag("cdp-timeout") as number,
                        what: "cdp_screenshot",
                    }),
                );
                const data = shot?.data as string | undefined;
                if (!data)
                    return fail(
                        new Error(
                            "screenshot failed: CDP returned no image data",
                        ),
                    );
                return {
                    content: [
                        {
                            type: "text",
                            text: `Screenshot captured (${format}, ${Math.round((data.length * 3) / 4 / 1024)} KB).`,
                        },
                        {
                            type: "image",
                            data,
                            mimeType:
                                format === "jpeg" ? "image/jpeg" : "image/png",
                        },
                    ],
                    details: {},
                };
            } catch (e) {
                return fail(e);
            }
        },
    };
    if (!pi.getFlag("no-screenshot")) pi.registerTool(screenshotTool);
}
