

## Headless browser via `Bun.WebView`

Bun ships a headless browser. Use for screenshots, scraping, clicking, form-fill, JS evaluation. Verify the CDP endpoint is up before opening the view: `curl -fsS http://127.0.0.1:9222/json/version` .
If not running, start with: `docker container run -d -p 9222:9222 chromedp/headless-shell:latest --no-sandbox --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222`

HOWTO:

```js
const ws = (await (await fetch("http://127.0.0.1:9222/json/version")).json()).webSocketDebuggerUrl;
const view = new Bun.WebView({ backend: { type: "chrome", url: ws }, width: 1280, height: 720 });
await view.navigate("https://example.com");
await Bun.sleep(2000); // or `await view.evaluate("document.fonts.ready.then(()=>'ok')")` for web fonts
await Bun.write("out.png", await view.screenshot());
view.close(); // or `await using view = …`
```

**Key methods:** `navigate(url)` (waits for `load` event), `evaluate(js)` (one in-flight per view), `click(selector)` (waits for actionable element), `type(text)` (focused element, fires `beforeinput`/`input` only), `press(key, {modifiers})` (`Enter`, `Tab`, `Escape`, `Arrow*`, modifiers `Shift|Control|Alt|Meta`), `scrollTo(selector)`, `screenshot({format, quality, encoding})` (`png|jpeg|webp`, `webp` is Chrome-only; `encoding: "buffer"|"base64"|"blob"`).

**Raw CDP:** `view.cdp("Method.Name", {params})` for any of the 56 CDP domains, and `view.addEventListener("Network.responseReceived", fn)` for CDP events. Requires a prior `await view.navigate(...)`.

**Gotchas:**
- `evaluate()` parses its argument as an *expression*, so top-level statements (`const`/`let`/`var`) fail. Wrap in an IIFE: `await view.evaluate("(()=>{ const x=1; return x; })()")`.
- **One op at a time per view** — second op throws `ERR_INVALID_STATE`. `await` each call; use multiple views for parallelism.
- Every `new Bun.WebView(...)` = new tab, which is good. Never reuse tabs/views you didn't create.
- **No state isolation** — all views share cookies, localStorage, and cache from the same Chrome profile.


