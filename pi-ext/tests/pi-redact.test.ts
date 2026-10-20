// pi-redact.ts tests: secret classification, parent .env discovery, and
// end-to-end Pi RPC redaction for user prompts and tool results.
// Run: PI_PATH=$(which pi) bun test ~/.kkrc/pi-ext/tests

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPi } from "./rpc";
import { isSecret, loadSecrets } from "../pi-redact";

const PI_REDACT = join(import.meta.dir, "..", "pi-redact.ts");
const REDACTED = "<REDACTED--PLEASE-DO-NOT-READ-SECRETS>";

let pi: ReturnType<typeof startPi> | undefined;
let dir: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-ext-redact-"));
});
afterEach(() => {
    pi?.stop();
    rmSync(dir, { recursive: true, force: true });
});

describe("isSecret", () => {
    it("accepts mixed alnum, hex, and UUID secrets >= 8 chars", () => {
        expect(isSecret("SkLive99abcXYZ")).toBe(true);
        expect(isSecret("PuiHeigiekoo6u")).toBe(true);
        expect(isSecret("D7s(bn`Z''/1bQFI")).toBe(true);
        expect(isSecret("}!UHCPw3$IY5z%AC")).toBe(true);
        expect(isSecret("hD0jCRzMyyktNpE6o0ge")).toBe(true);
        expect(isSecret("asbestos-hustle-splashed-thrills")).toBe(true);
        expect(isSecret("Devon-telugu-energy-upsets-rake")).toBe(true);
        expect(isSecret("a1b2c3d4e5f60718")).toBe(true); // lowercase hex
        expect(isSecret("DEADBEEF01234567")).toBe(true); // uppercase hex
        expect(isSecret("550e8400-e29b-41d4-a716-446655440000")).toBe(true); // UUID
    });

    it("ignores short, numeric, whitespace, or single-case non-hex strings", () => {
        expect(isSecret("Ab1")).toBe(false); // < 8 chars
        expect(isSecret("")).toBe(false); // empty
        expect(isSecret("My cool application name")).toBe(false); // has spaces
        expect(isSecret("1234567890")).toBe(false); // purely numeric
        expect(isSecret("Has Space 123")).toBe(false); // contains space
        expect(isSecret("production")).toBe(false); // lowercase only (non-hex)
        expect(isSecret("PRODUCTION")).toBe(false); // uppercase only (non-hex)
        expect(isSecret("secret1234")).toBe(false); // no uppercase (non-hex)
        expect(isSecret("SECRET1234")).toBe(false); // no lowercase (non-hex)
        expect(isSecret("SecretOnly")).toBe(false); // no digits (non-hex)
        expect(isSecret("https://example.com/")).toBe(false); // URL
        expect(isSecret("http://localhost")).toBe(false); // URL
        expect(isSecret("127.0.0.1")).toBe(false); // IP
        expect(isSecret("3306")).toBe(false); // port
        expect(isSecret("us-east-1")).toBe(false); // AWS zone
        expect(isSecret("null")).toBe(false);
        expect(isSecret("false")).toBe(false);
        expect(isSecret("False")).toBe(false);
    });
});

describe("loadSecrets", () => {
    it("walks from cwd up to parent directories, reads all .env* files, and sorts longest-first", () => {
        const sub = join(dir, "a", "b");
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(dir, ".env"), "ROOT_KEY=RootSecret123\nTRIVIAL=12345678\n");
        writeFileSync(join(sub, ".env.local"), "SUB_KEY=RootSecret123Extended99\n");
        writeFileSync(join(sub, ".env.prod"), "PROD_KEY=ProdSecret999\n");

        expect(loadSecrets(sub)).toEqual(["RootSecret123Extended99", "ProdSecret999", "RootSecret123"]);
    });
});

describe("pi-redact extension", () => {
    it("redacts secrets from .env* in outbound context before the LLM sees them, ignoring trivial values", async () => {
        const sub = join(dir, "nested");
        mkdirSync(sub);
        // Parent .env has a mixed-alnum secret and a UUID; nested .env.local has a hex secret and trivial values
        writeFileSync(
            join(dir, ".env"),
            "API_KEY=Sup3rSecr3tKey\nUUID_TOKEN=550e8400-e29b-41d4-a716-446655440000\n",
        );
        writeFileSync(
            join(sub, ".env.local"),
            "HEX_KEY=deadbeefcafebabe01\nPORT=8080\nMODE=production\nNOTE=\"has spaces Ab1\"\n",
        );

        pi = startPi([PI_REDACT], { cwd: sub });
        await pi.turn(
            "key=Sup3rSecr3tKey hex=deadbeefcafebabe01 uuid=550e8400-e29b-41d4-a716-446655440000 port=8080 mode=production",
        );

        expect(await pi.lastText()).toBe(
            `SEEN: key=${REDACTED} hex=${REDACTED} uuid=${REDACTED} port=8080 mode=production`,
        );
    });

    it("reloads .env* secrets on session_start (fired by /reload and new_session)", async () => {
        pi = startPi([PI_REDACT], { cwd: dir });
        await pi.turn("before=NewSecretAddedLater99");
        expect(await pi.lastText()).toBe("SEEN: before=NewSecretAddedLater99");

        writeFileSync(join(dir, ".env.local"), "LATE_KEY=NewSecretAddedLater99\n");
        await pi.send({ type: "new_session" });
        await pi.turn("after=NewSecretAddedLater99");

        expect(await pi.lastText()).toBe(`SEEN: after=${REDACTED}`);
    });

    it("redacts secrets in tool results (e.g. reading files with secrets)", async () => {
        writeFileSync(join(dir, ".env"), "SECRET_TOKEN=MyTopSecret99\n");
        writeFileSync(join(dir, "README.md"), "token is MyTopSecret99 here\n");

        pi = startPi([PI_REDACT], { cwd: dir });
        await pi.turn("TOOLS"); // triggers bash `echo hi` and read `README.md`

        const msgs = (await pi.send({ type: "get_messages" })).data?.messages as any[];
        const readResult = msgs.find((m) => m.role === "toolResult" && m.toolName === "read");
        const text = readResult.content.map((c: any) => c.text).join("");
        expect(text).toContain(`token is ${REDACTED} here`);
        expect(text).not.toContain("MyTopSecret99");
    });
});
