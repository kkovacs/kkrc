// clean.ts against a real Pi with the faux LLM (see rpc.ts and faux-llm.ts).
// Each test runs Pi in a temp dir, so tool results don't depend on where
// the tests are started.
// Run: bun test ~/.kkrc/pi-ext

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPi } from "./rpc";

const CLEAN = join(import.meta.dir, "..", "clean.ts");

let pi: ReturnType<typeof startPi> | undefined;
let dir: string;
beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-ext-clean-"));
    writeFileSync(join(dir, "README.md"), "hello readme\n"); // read by the faux "TOOLS" turn
});
afterEach(() => {
    pi?.stop();
    rmSync(dir, { recursive: true, force: true });
});

const sessionId = async () => (await pi!.send({ type: "get_state" })).data?.sessionId as string;

describe("/clean", () => {
    it("seeds the editor of a fresh session with the compacted branch", async () => {
        pi = startPi([CLEAN], { cwd: dir });
        for (const m of ["one", "TOOLS", "THINK"]) await pi.turn(m);
        await pi.send({ type: "bash", command: "printf 'a\\nb'" }); // user `!` command
        const oldId = await sessionId();

        await pi.turn("/clean");

        expect(pi.editorTexts).toEqual([
            `Here is a summary of our previous session ${oldId}.\n\n` +
            "# User\n\none\n\n" +
            "# Assistant\n\nSEEN: one\n\n" +
            "# User\n\nTOOLS\n\n" +
            // consecutive tool-only messages share one heading; tool results are dropped
            "# Assistant\n\n[bash] echo hi\n[read] README.md\n\n" +
            "# Assistant\n\nSEEN: one | TOOLS\n\n" +
            "# User\n\nTHINK\n\n" +
            // thinking is dropped
            "# Assistant\n\nSEEN: one | TOOLS | THINK\n\n" +
            "# User\n\n[bash] printf 'a\\nb'\na\nb\n\n" +
            "# User - Let's continue on this:\n\n",
        ]);
        expect(await sessionId()).not.toBe(oldId);
        expect((await pi.send({ type: "get_messages" })).data?.messages).toEqual([]); // not sent
    });

    it("reports the size change", async () => {
        pi = startPi([CLEAN], { cwd: dir });
        await pi.turn("one");

        await pi.turn("/clean");

        // "one" + "SEEN: one" = 12 chars → "# User\n\none\n\n# Assistant\n\nSEEN: one" = 35
        expect(pi.notifies).toEqual([{ message: "/clean: 12 → 35 chars (reduced to 292%)", notifyType: "success" }]);
    });

    it("the new session starts with an empty LLM context", async () => {
        pi = startPi([CLEAN], { cwd: dir });
        await pi.turn("one");

        await pi.turn("/clean");
        await pi.turn("two");

        expect(await pi.lastText()).toBe("SEEN: two");
    });

    it("refuses an empty session and stays in it", async () => {
        pi = startPi([CLEAN], { cwd: dir });
        const oldId = await sessionId();

        await pi.turn("/clean");

        // A fresh branch already holds the system prompt and model entries
        expect(pi.notifies).toEqual([{ message: "Nothing to clean (no serializable messages)", notifyType: "error" }]);
        expect(pi.editorTexts).toEqual([]);
        expect(await sessionId()).toBe(oldId);
    });

    it("leaves the original session file untouched and links the new one to it", async () => {
        const sessions = join(dir, "sessions");
        mkdirSync(sessions);
        pi = startPi([CLEAN], { cwd: dir, args: ["--session-dir", sessions] });
        for (const m of ["one", "two"]) await pi.turn(m);
        const [oldFile] = readdirSync(sessions);
        const before = readFileSync(join(sessions, oldFile!), "utf8");

        await pi.turn("/clean");
        await pi.turn("three"); // makes Pi write the new session file
        pi.stop();

        const files = readdirSync(sessions);
        expect(files.length).toBe(2);
        expect(readFileSync(join(sessions, oldFile!), "utf8")).toBe(before);
        const newFile = files.find((f) => f !== oldFile)!;
        const header = JSON.parse(readFileSync(join(sessions, newFile), "utf8").split("\n")[0]!);
        expect(header.parentSession).toBe(join(sessions, oldFile!));
    });
});
