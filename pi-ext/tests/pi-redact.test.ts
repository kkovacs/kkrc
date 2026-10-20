// pi-redact.ts tests: secret classification, parent .env discovery, and
// end-to-end Pi RPC redaction for user prompts and tool results.
// Run: PI_PATH=$(which pi) bun test ~/.kkrc/pi-ext/tests

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPi } from "./rpc";
import { extractSecret, isSecret, loadSecrets } from "../pi-redact";

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
        expect(isSecret("sk_live_abcdefghijkl")).toBe(true); // sk_ prefix (all lowercase)
        expect(isSecret("sk-ant-api03-abcdefgh")).toBe(true); // sk- prefix (no uppercase)
        expect(
            isSecret("-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA12345678\n-----END RSA PRIVATE KEY-----"),
        ).toBe(true);
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
        expect(isSecret("https://example.com/ApiV1/2026")).toBe(false); // URL with mixed case + digits
        expect(isSecret("https://user:MyPass123@domain.com/uri")).toBe(false); // full URL is not itself the secret
        expect(isSecret("http://localhost")).toBe(false); // URL
        expect(isSecret("127.0.0.1")).toBe(false); // IP
        expect(isSecret("3306")).toBe(false); // port
        expect(isSecret("us-east-1")).toBe(false); // AWS zone
        expect(isSecret("null")).toBe(false);
        expect(isSecret("false")).toBe(false);
        expect(isSecret("False")).toBe(false);
    });

    it("accepts simpler values when key name ends with KEY/PASS/PASSWORD/SECRET/TOKEN/_PWD", () => {
        // Positive key-name cases (values that would fail without key name)
        expect(isSecret("onlylowercase", "API_KEY")).toBe(true);
        expect(isSecret("tiger", "DB_PASS")).toBe(true);
        expect(isSecret("12345678", "ADMIN_PASSWORD")).toBe(true);
        expect(isSecret("secret", "JWT_SECRET")).toBe(true);
        expect(isSecret("simpletoken", "AUTH_TOKEN")).toBe(true);
        expect(isSecret("mysqlpass", "MYSQL_PWD")).toBe(true);

        // Negative key-name cases
        expect(isSecret("rsa", "KEY_TYPE")).toBe(false); // KEY is prefix, not suffix
        expect(isSecret("2048", "KEY_SIZE")).toBe(false); // KEY is prefix, not suffix
        expect(isSecret("3600", "TOKEN_TTL")).toBe(false); // TOKEN is prefix, not suffix
        expect(isSecret("true", "PASS_THROUGH")).toBe(false); // PASS is prefix + boolean
        expect(isSecret("/home/user", "PWD")).toBe(false); // bare PWD (working dir) ignored
        expect(isSecret("null", "API_KEY")).toBe(false); // trivial literal
        expect(isSecret("false", "USE_KEY")).toBe(false); // trivial literal
        expect(isSecret("ab", "API_KEY")).toBe(false); // < 4 chars
    });
});

describe("extractSecret", () => {
    it("extracts strong passwords from URLs and ignores URLs without strong passwords", () => {
        // Positive URL cases
        expect(extractSecret("https://user:MyPass123@domain.com/uri")).toBe("MyPass123");
        expect(extractSecret("http://user:LocalPass123@127.0.0.1")).toBe("LocalPass123");
        expect(extractSecret("postgres://dbuser:D7s(bn`Z''1bQFI@db.internal:5432/prod")).toBe("D7s(bn`Z''1bQFI");
        expect(extractSecret("redis://:a1b2c3d4e5f60718@localhost:6379/0")).toBe("a1b2c3d4e5f60718");

        // Negative URL cases
        expect(extractSecret("https://example.com/ApiV1/2026")).toBeNull(); // no credentials
        expect(extractSecret("https://user@domain.com/ApiV1/2026")).toBeNull(); // user only, no password
        expect(extractSecret("https://domain.com:8443/PathWith@AtSign1")).toBeNull(); // port + @ in path, not userinfo
        expect(extractSecret("postgres://postgres:postgres@localhost:5432/db")).toBeNull(); // trivial password
    });
});

describe("loadSecrets", () => {
    it("walks from cwd up to parent directories, reads all .env* files, adds encoded variants, and sorts longest-first", () => {
        const sub = join(dir, "a", "b");
        mkdirSync(sub, { recursive: true });
        writeFileSync(join(dir, ".env"), "ROOT_KEY=RootSecret123\nTRIVIAL=12345678\n");
        writeFileSync(join(sub, ".env.local"), "SUB_KEY=D7s(bn`Z''/1bQFI\n");
        writeFileSync(
            join(sub, ".env.prod"),
            "DB_URL=postgres://admin:UrlPass99xyz@db.example.com:5432/app\nPUBLIC_URL=https://example.com/ApiV1/2026\n" +
                "PEM=\"-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw\\n-----END PRIVATE KEY-----\"\n",
        );

        const loaded = loadSecrets(sub);
        // Raw secrets
        expect(loaded).toContain("RootSecret123");
        expect(loaded).toContain("D7s(bn`Z''/1bQFI");
        expect(loaded).toContain("UrlPass99xyz");
        // URL-encoded and base64 variants
        expect(loaded).toContain(encodeURIComponent("D7s(bn`Z''/1bQFI"));
        expect(loaded).toContain(Buffer.from("RootSecret123").toString("base64"));
        // PEM body line
        expect(loaded).toContain("MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw");
        // Sorted longest-first
        for (let i = 1; i < loaded.length; i++) {
            expect(loaded[i - 1]!.length).toBeGreaterThanOrEqual(loaded[i]!.length);
        }
    });
});

describe("pi-redact extension", () => {
    it("redacts raw, base64, URL-encoded, and PEM secrets in outbound context and emits a warning", async () => {
        const sub = join(dir, "nested");
        mkdirSync(sub);
        writeFileSync(
            join(dir, ".env"),
            "API_KEY=D7s(bn`Z''/1bQFI\nUUID_TOKEN=550e8400-e29b-41d4-a716-446655440000\nDB_URL=https://user:UrlSecr3t99@domain.com/uri\n",
        );
        writeFileSync(
            join(sub, ".env.local"),
            "HEX_KEY=deadbeefcafebabe01\nPORT=8080\nMODE=production\nNOTE=\"has spaces Ab1\"\n" +
                "SSH_KEY=\"-----BEGIN OPENSSH PRIVATE KEY-----\\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\\n-----END OPENSSH PRIVATE KEY-----\"\n",
        );

        const b64 = Buffer.from("deadbeefcafebabe01").toString("base64");
        const urlEnc = encodeURIComponent("D7s(bn`Z''/1bQFI");

        pi = startPi([PI_REDACT], { cwd: sub });
        await pi.turn(
            `urlEnc=${urlEnc} b64=${b64} uuid=550e8400-e29b-41d4-a716-446655440000 url=https://user:UrlSecr3t99@domain.com/uri pem=b3BlbnNzaC1rZXktdjEAAAAABG5vbmU= port=8080 mode=production`,
        );

        expect(await pi.lastText()).toBe(
            `SEEN: urlEnc=${REDACTED} b64=${REDACTED} uuid=${REDACTED} url=https://user:${REDACTED}@domain.com/uri pem=${REDACTED} port=8080 mode=production`,
        );
        expect(pi.notifies).toEqual([
            { message: "pi-redact: Protecting 5 secrets", notifyType: "info" },
            { message: "pi-redact: Redacted secret in outbound LLM context", notifyType: "warning" },
        ]);
    });

    it("reloads .env* secrets on session_start (fired by /reload and new_session)", async () => {
        pi = startPi([PI_REDACT], { cwd: dir });
        await pi.turn("before=NewSecretAddedLater99");
        expect(await pi.lastText()).toBe("SEEN: before=NewSecretAddedLater99");

        writeFileSync(join(dir, ".env.local"), "LATE_KEY=NewSecretAddedLater99\n");
        await pi.send({ type: "new_session" });
        await pi.turn("after=NewSecretAddedLater99");

        expect(await pi.lastText()).toBe(`SEEN: after=${REDACTED}`);
        expect(pi.notifies).toContainEqual({
            message: "pi-redact: Protecting 1 secret",
            notifyType: "info",
        });
    });

    it("redacts secrets in tool results and notifies with a warning", async () => {
        writeFileSync(join(dir, ".env"), "SECRET_TOKEN=MyTopSecret99\n");
        writeFileSync(join(dir, "README.md"), "token is MyTopSecret99 here\n");

        pi = startPi([PI_REDACT], { cwd: dir });
        await pi.turn("TOOLS"); // triggers bash `echo hi` and read `README.md`

        const msgs = (await pi.send({ type: "get_messages" })).data?.messages as any[];
        const readResult = msgs.find((m) => m.role === "toolResult" && m.toolName === "read");
        const text = readResult.content.map((c: any) => c.text).join("");
        expect(text).toContain(`token is ${REDACTED} here`);
        expect(text).not.toContain("MyTopSecret99");
        expect(pi.notifies).toEqual([
            { message: "pi-redact: Protecting 1 secret", notifyType: "info" },
            { message: "pi-redact: Redacted secret in read tool output", notifyType: "warning" },
        ]);
    });
});
