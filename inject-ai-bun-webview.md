

## Headless browser via `Bun.WebView`

Bun ships a headless browser — **zero npm deps**. Use for screenshots, scraping, clicking, form-fill, JS evaluation. Verify the CDP endpoint is up before opening the view: `curl -fsS http://127.0.0.1:9222/json/version` .
If not running, start with: `docker container run -d -p 9222:9222 chromedp/headless-shell:latest --no-sandbox --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222`

HOWTO:

```js
const ws = (await (await fetch("http://127.0.0.1:9222/json/version")).json()).webSocketDebuggerUrl;
const view = new Bun.WebView({ backend: { type: "chrome", url: ws }, width: 1280, height: 720 });
await view.navigate("https://example.com");
await Bun.sleep(2000);                         // let page render (3000+ for web fonts)
await Bun.write("out.png", await view.screenshot());
view.close();                                  // or `await using view = …`
```

**Key methods:** `navigate(url)` (waits for `load` event), `evaluate(js)` (one in-flight per view), `click(selector)` (waits for actionable element), `type(text)` (focused element, fires `beforeinput`/`input` only), `press(key, {modifiers})` (`Enter`, `Tab`, `Escape`, `Arrow*`, modifiers `Shift|Control|Alt|Meta`), `scrollTo(selector)`, `screenshot({format, quality, encoding})` (`png|jpeg|webp`, `webp` is Chrome-only; `encoding: "buffer"|"base64"|"blob"|"shmem"`).

**Gotchas:**
- `evaluate()` parses its argument as an *expression*, so top-level statements (`const`/`let`/`var`) fail. Wrap in an IIFE: `await view.evaluate("(()=>{ const x=1; return x; })()")`.
- `scrollTo` takes a selector string; use `evaluate("window.scrollTo(x,y)")` for coordinates.
- **Never run methods on the same view in parallel.** `evaluate()` throws if another call is in-flight. Create multiple views for parallelism, or `await` each call sequentially.
- For web fonts, sleep ≥3s or `await view.evaluate("document.fonts.ready.then(()=>'ok')")`.


