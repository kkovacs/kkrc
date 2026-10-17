/**
 * rpc.ts — Minimal Pi RPC driver for extension tests
 *
 * startPi() spawns `pi --mode rpc` with the faux LLM (faux-llm.ts) plus the
 * given extensions. No network, no tokens. `args` default to --no-session;
 * `cwd` is where Pi (and its tools) run; `env` is added to the environment.
 * Used by: *.test.ts in this directory.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const PI_PATH = (process.env.PI_PATH ?? join(homedir(), ".pi", "pi")).replace(/^~/, homedir());
export const HAVE_PI = existsSync(PI_PATH);

type Event = Record<string, any>;

export function startPi(extensions: string[], opts: { args?: string[]; cwd?: string; env?: Record<string, string> } = {}) {
    const args = ["--mode", "rpc", ...(opts.args ?? ["--no-session"]), "--provider", "faux", "--model", "faux-1",
        "-e", join(import.meta.dir, "faux-llm.ts"), ...extensions.flatMap((e) => ["-e", e])];
    const proc = Bun.spawn([PI_PATH, ...args], { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });

    const waiters: ((e: Event) => boolean)[] = [];
    const notifies: { message: string; notifyType: string }[] = [];
    const editorTexts: string[] = [];
    const onEvent = (e: Event) => {
        if (e.type === "extension_ui_request" && e.method === "notify") {
            notifies.push({ message: e.message, notifyType: e.notifyType ?? "info" });
        }
        if (e.type === "extension_ui_request" && e.method === "set_editor_text") editorTexts.push(e.text);
        for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i]!(e)) waiters.splice(i, 1);
    };
    // \n-only JSONL framing (JSON strings may contain U+2028/U+2029)
    void (async () => {
        let buf = "";
        for await (const chunk of proc.stdout) {
            buf += new TextDecoder().decode(chunk);
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (line) onEvent(JSON.parse(line));
            }
        }
    })();

    const until = (match: (e: Event) => boolean) =>
        new Promise<Event>((resolve) => waiters.push((e) => (match(e) ? (resolve(e), true) : false)));

    let nextId = 0;
    const send = (cmd: Event): Promise<Event> => {
        const id = `t${++nextId}`;
        proc.stdin.write(JSON.stringify({ ...cmd, id }) + "\n");
        proc.stdin.flush();
        return until((e) => e.type === "response" && e.id === id);
    };

    return {
        notifies,
        editorTexts,
        send,
        until,
        // Prompt and wait until Pi is idle again
        async turn(message: string): Promise<void> {
            const settled = until((e) => e.type === "agent_settled");
            const resp = await send({ type: "prompt", message });
            if (resp.data?.disposition === "started") await settled;
        },
        async lastText(): Promise<string | undefined> {
            return (await send({ type: "get_last_assistant_text" })).data?.text;
        },
        stop() {
            proc.kill();
        },
    };
}
