// autollm.ts against a real Pi, with a fake OpenAI-compatible server
// (LLM_URL points at it). Checks the models Pi ends up with.
// Run: bun test ~/.kkrc/pi-ext

import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { startPi } from "./rpc";

const EXT = join(import.meta.dir, "..", "autollm.ts");

let pi: ReturnType<typeof startPi> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
    pi?.stop();
    server?.stop(true);
});

// Fake server: `routes` maps a path to its JSON body, anything else is 404
function serve(routes: Record<string, unknown>): string {
    server = Bun.serve({
        port: 0,
        fetch(req) {
            const body = routes[new URL(req.url).pathname];
            return body === undefined ? new Response("not found", { status: 404 }) : Response.json(body);
        },
    });
    return `http://127.0.0.1:${server.port}`;
}

async function autollmModels(url: string) {
    pi = startPi([EXT], { env: { LLM_URL: url } });
    const resp = await pi.send({ type: "get_available_models" });
    return (resp.data?.models as any[]).filter((m) => m.provider === "autollm");
}

describe("autollm", () => {
    it("merges llama.cpp's data and models lists by id", async () => {
        const url = serve({
            "/v1/models": {
                data: [{ id: "big", meta: { n_ctx: 32768 } }, { id: "small" }],
                models: [{ id: "big", capabilities: ["completion", "multimodal"] }],
            },
        });

        const models = await autollmModels(url);

        expect(models.map((m) => [m.id, m.contextWindow, m.input, m.baseUrl])).toEqual([
            ["big", 32768, ["text", "image"], `${url}/v1`],
            ["small", 128_000, ["text"], `${url}/v1`], // defaults
        ]);
        expect(pi!.notifies).toEqual([{ message: `🧠 autollm: 2 models at ${url}`, notifyType: "warning" }]);
    });

    it("falls back to /models, then chats without /v1", async () => {
        const url = serve({ "/models": { data: [{ id: "m", context_window: 8192 }] } });

        const models = await autollmModels(url);

        expect(models.map((m) => [m.id, m.contextWindow, m.baseUrl])).toEqual([["m", 8192, url]]);
        expect(pi!.notifies).toEqual([{ message: `🧠 autollm: 1 model at ${url}`, notifyType: "warning" }]);
    });

    it("registers nothing when the server is unreachable, and Pi still starts", async () => {
        const url = serve({});
        server!.stop(true); // port now refuses connections

        expect(await autollmModels(url)).toEqual([]);
        expect(pi!.notifies).toEqual([]);
    });
});
