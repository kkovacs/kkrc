// local-llm.ts against a real Pi, with a fake OpenAI-compatible server
// (LOCAL_URL points at it). Checks the models Pi ends up with.
// Run: bun test ~/.kkrc/pi-ext

import { describe, it, expect, afterEach } from "bun:test";
import { join } from "node:path";
import { startPi } from "./rpc";

const LOCAL_LLM = join(import.meta.dir, "..", "local-llm.ts");

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

async function localModels(url: string) {
    pi = startPi([LOCAL_LLM], { env: { LOCAL_URL: url } });
    const resp = await pi.send({ type: "get_available_models" });
    return (resp.data?.models as any[]).filter((m) => m.provider === "local-llm");
}

describe("local-llm", () => {
    it("merges llama.cpp's data and models lists by id", async () => {
        const url = serve({
            "/v1/models": {
                data: [{ id: "big", meta: { n_ctx: 32768 } }, { id: "small" }],
                models: [{ id: "big", capabilities: ["completion", "multimodal"] }],
            },
        });

        const models = await localModels(url);

        expect(models.map((m) => [m.id, m.contextWindow, m.input, m.baseUrl])).toEqual([
            ["big", 32768, ["text", "image"], `${url}/v1`],
            ["small", 128_000, ["text"], `${url}/v1`], // defaults
        ]);
    });

    it("falls back to /models, then chats without /v1", async () => {
        const url = serve({ "/models": { data: [{ id: "m", context_window: 8192 }] } });

        const models = await localModels(url);

        expect(models.map((m) => [m.id, m.contextWindow, m.baseUrl])).toEqual([["m", 8192, url]]);
    });

    it("registers nothing when the server is unreachable, and Pi still starts", async () => {
        const url = serve({});
        server!.stop(true); // port now refuses connections

        expect(await localModels(url)).toEqual([]);
    });
});
