// undo.ts against a real Pi with the faux LLM (see rpc.ts). The faux model
// replies "SEEN: <user msgs>", so its reply shows what the LLM gets after undo.
// Run: bun test ~/.kkrc/pi-ext

import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HAVE_PI, startPi } from "./rpc";

const UNDO = join(import.meta.dir, "..", "undo.ts");

let pi: ReturnType<typeof startPi> | undefined;
afterEach(() => pi?.stop());

async function withTurns(...messages: string[]) {
    pi = startPi([UNDO]);
    for (const m of messages) await pi.turn(m);
    return pi;
}

describe.skipIf(!HAVE_PI)("/undo", () => {
    it("undoes the last user message; the LLM no longer sees it", async () => {
        const pi = await withTurns("one", "two", "three");

        await pi.turn("/undo");
        expect(pi.notifies).toEqual([{ message: "Undid 1 message. Now at:\nSEEN: one | two", notifyType: "info" }]);
        expect(await pi.lastText()).toBe("SEEN: one | two");

        await pi.turn("four");
        expect(await pi.lastText()).toBe("SEEN: one | two | four");
    });

    it("undoes n messages", async () => {
        const pi = await withTurns("one", "two", "three");

        await pi.turn("/undo 2");
        await pi.turn("four");

        expect(pi.notifies[0]?.message).toBe("Undid 2 messages. Now at:\nSEEN: one");
        expect(await pi.lastText()).toBe("SEEN: one | four");
    });

    it("repeated /undo keeps going back", async () => {
        const pi = await withTurns("one", "two", "three");

        await pi.turn("/undo");
        await pi.turn("/undo");
        await pi.turn("four");

        expect(await pi.lastText()).toBe("SEEN: one | four");
    });

    it("caps n at the number of user messages", async () => {
        const pi = await withTurns("one", "two");

        await pi.turn("/undo 9");
        await pi.turn("three");

        expect(pi.notifies[0]?.message).toBe("Undid 2 messages. Now at:\n(empty session)");
        expect(await pi.lastText()).toBe("SEEN: three");
    });

    it("rejects a bad n without undoing", async () => {
        const pi = await withTurns("one", "two");

        for (const arg of ["x", "0", "-1", "1.5"]) await pi.turn(`/undo ${arg}`);
        await pi.turn("three");

        expect(pi.notifies).toEqual(Array(4).fill({ message: "Usage: /undo [n]", notifyType: "warning" }));
        expect(await pi.lastText()).toBe("SEEN: one | two | three");
    });

    it("warns when there is nothing to undo", async () => {
        const pi = await withTurns();

        await pi.turn("/undo");

        expect(pi.notifies).toEqual([{ message: "Nothing to undo", notifyType: "warning" }]);
    });

    it("shows only the tail of a long new-last message", async () => {
        const pi = await withTurns("LONG", "two");

        await pi.turn("/undo");

        expect(pi.notifies[0]?.message).toBe("Undid 1 message. Now at:\n…" + "A".repeat(197) + "END");
    });

    it("skips empty assistant messages when showing the new last message", async () => {
        const pi = await withTurns("one", "EMPTY", "three");

        await pi.turn("/undo");

        expect(pi.notifies[0]?.message).toBe("Undid 1 message. Now at:\nEMPTY");
    });

    it("fails without undoing while Pi is streaming", async () => {
        const pi = await withTurns("one");
        const settled = pi.until((e) => e.type === "agent_settled");

        await pi.send({ type: "prompt", message: "SLOW" });
        await pi.send({ type: "prompt", message: "/undo" }); // steer would refuse an extension command
        await settled;

        expect(pi.notifies).toEqual([{
            message: "Undo failed: Wait for the current response to finish before navigating the session tree.",
            notifyType: "error",
        }]);
        expect(await pi.lastText()).toBe("SEEN: one | SLOW");
    });

    it("keeps the undone entries in the same session file", async () => {
        const dir = mkdtempSync(join(tmpdir(), "pi-ext-undo-"));
        try {
            pi = startPi([UNDO], { args: ["--session-dir", dir] });
            for (const m of ["one", "two", "/undo", "three"]) await pi.turn(m);
            pi.stop();

            const files = readdirSync(dir);
            expect(files.length).toBe(1);
            const users = readFileSync(join(dir, files[0]!), "utf8").trim().split("\n").map((l) => JSON.parse(l))
                .filter((e) => e.type === "message" && e.message.role === "user")
                .map((e) => e.message.content.map((c: any) => c.text).join(""));
            expect(users).toEqual(["one", "two", "three"]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
