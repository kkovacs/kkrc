

## Headless browser via `Bun.WebView`

Bun ships a headless browser — **zero npm deps**. Use for screenshots, scraping, clicking, form-fill, JS evaluation. Verify the CDP endpoint is up before opening the view: `curl -fsS http://127.0.0.1:9222/json/version` .
If not running, start with: `docker container run -d -p 9222:9222 zenika/alpine-chrome --no-sandbox --remote-debugging-address=0.0.0.0 --remote-debugging-port=9222`

HOWTO:

```js
const view = new Bun.WebView({ backend: { type: "chrome", url: "http://localhost:9222" }, width: 1280, height: 720 });
await view.navigate("https://example.com");
await Bun.sleep(2000);                         // let page render (3000+ for web fonts)
await Bun.write("out.png", await view.screenshot());
view.close();                                  // or use `await using view = …`
```

**Key methods:** `navigate(url)` (waits for `load` event), `evaluate(js)` (one in-flight per view), `click(x|selector, y?, opts?)` (waits for actionable element), `type(text)` (focused element, fires `beforeinput`/`input` only), `press(key, {modifiers})` (`Enter`, `Tab`, `Escape`, `Arrow*`, modifiers `Shift|Control|Alt|Meta`), `scrollTo(x,y)`, `screenshot({format, quality, encoding})` (`png|jpeg|webp`, `webp` is Chrome-only; `encoding: "buffer"|"base64"|"blob"|"shmem"`).

**Gotchas:**
- For web fonts, sleep ≥3s or `await view.evaluate("document.fonts.ready.then(()=>'ok')")`.


