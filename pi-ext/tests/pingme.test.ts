// pingme.ts against a real Pi with the faux LLM (see rpc.ts). A local HTTP
// server counts the pings; --pingme-after 1 keeps the tests fast, and the
// faux "SLOW" turn takes 1.5s.
// Run: bun test ~/.kkrc/pi-ext

import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { HAVE_PI, startPi } from "./rpc";

const PINGME = join(import.meta.dir, "..", "pingme.ts");

let pi: ReturnType<typeof startPi> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
    pi?.stop();
    server?.stop(true);
});

// Starts the ping counter; returns its URL and the paths it was called with
function counter() {
    const hits: string[] = [];
    server = Bun.serve({
        port: 0,
        fetch(req) {
            hits.push(new URL(req.url).pathname);
            return new Response("ok");
        },
    });
    return { url: `http://127.0.0.1:${server.port}/done`, hits };
}

// The ping is fire-and-forget after agent_settled, so give it a moment
const pingWindow = () => Bun.sleep(300);

describe.skipIf(!HAVE_PI)("pingme", () => {
    it("pings after a run longer than --pingme-after", async () => {
        const { url, hits } = counter();
        pi = startPi([PINGME], { args: ["--no-session", "--pingme", url, "--pingme-after", "1"] });

        await pi.turn("SLOW");
        await pingWindow();

        expect(hits).toEqual(["/done"]);
    });

    it("does not ping after a shorter run", async () => {
        const { url, hits } = counter();
        pi = startPi([PINGME], { args: ["--no-session", "--pingme", url, "--pingme-after", "1"] });

        await pi.turn("one");
        await pingWindow();

        expect(hits).toEqual([]);
    });

    it("does nothing without --pingme", async () => {
        const { hits } = counter();
        pi = startPi([PINGME], { args: ["--no-session", "--pingme-after", "1"] });

        await pi.turn("SLOW");
        await pingWindow();

        expect(hits).toEqual([]);
    });
});
