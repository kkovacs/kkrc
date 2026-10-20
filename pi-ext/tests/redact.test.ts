// redact.ts tests: secret classification, parent .env discovery, and
// end-to-end Pi RPC redaction for user prompts and tool results.
// Run: PI_PATH=$(which pi) bun test ~/.kkrc/pi-ext/tests

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPi } from "./rpc";
import { extractSecret, isSecret, loadSecrets } from "../redact";

const REDACT_EXT = join(import.meta.dir, "..", "redact.ts");
const REDACTED = "<REDACTED--PLEASE-DO-NOT-READ-SECRETS>";

let pi: ReturnType<typeof startPi> | undefined;
let dir: string;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pi-ext-redact-"));
    // Strip host secret-named env vars so subprocess secret counts are deterministic.
    savedEnv = {};
    for (const k of Object.keys(process.env)) {
        if (/(?:^|_)(?:KEY|PASS|PASSWORD|SECRET|TOKEN|URL|URI)$|_PWD$/i.test(k)) {
            savedEnv[k] = process.env[k];
            delete process.env[k];
        }
    }
});
afterEach(() => {
    pi?.stop();
    rmSync(dir, { recursive: true, force: true });
    Object.assign(process.env, savedEnv);
});

describe("isSecret", () => {
    it("accepts known token prefixes >= 8 chars regardless of key name", () => {
        expect(isSecret("sk_live_abcdefghijkl")).toBe(true);
        expect(isSecret("sk-ant-api03-abcdefgh")).toBe(true);
        expect(isSecret("rk_live_1234567890")).toBe(true);
        expect(isSecret("whsec_1234567890abcdef")).toBe(true);
        expect(isSecret("ghp_1234567890abcdef")).toBe(true);
        expect(isSecret("github_pat_1234567890")).toBe(true);
        expect(isSecret("glpat-1234567890abcdef")).toBe(true);
        expect(isSecret("xoxb-1234567890-abcdef")).toBe(true);
        expect(isSecret("xapp-1-A123-4567890")).toBe(true);
        expect(isSecret("AKIAIOSFODNN7EXAMPLE")).toBe(true);
        expect(isSecret("AIzaSyDaGmWKa4JsXZ-example")).toBe(true);
        expect(isSecret("hf_1234567890abcdef")).toBe(true);
        expect(isSecret("npm_1234567890abcdef")).toBe(true);
        expect(isSecret("pypi-AgEIcHlwaS5vcmc")).toBe(true);
        expect(isSecret("SG.1234567890abcdef")).toBe(true);
    });

    it("ignores unnamed generic values, short strings, whitespace, paths, and URLs", () => {
        expect(isSecret("sk_123")).toBe(false); // < 8 chars
        expect(isSecret("")).toBe(false); // empty
        expect(isSecret("My cool application name")).toBe(false); // has spaces
        expect(isSecret("1234567890")).toBe(false); // purely numeric
        expect(isSecret("production")).toBe(false); // plain word
        expect(isSecret("a1b2c3d4e5f60718")).toBe(false); // unnamed hex (e.g. git SHA)
        expect(isSecret("550e8400-e29b-41d4-a716-446655440000")).toBe(false); // unnamed UUID (e.g. tenant ID)
        expect(isSecret("acme-prod-static-assets")).toBe(false); // unnamed kebab-case slug
        expect(isSecret("gpt4oMini2024")).toBe(false); // unnamed mixed alnum
        expect(isSecret("https://example.com/ApiV1/2026")).toBe(false); // URL
        expect(isSecret("https://user:MyPass123@domain.com/uri")).toBe(false); // full URL is not itself the secret
        expect(isSecret("/etc/ssl/private/key.pem")).toBe(false); // file path
        expect(isSecret("127.0.0.1")).toBe(false); // IP
        expect(isSecret("3306")).toBe(false); // port
        expect(isSecret("us-east-1")).toBe(false); // AWS zone
        expect(isSecret("false")).toBe(false);
    });

    it("accepts values >= 8 chars when key name ends with KEY/PASS/PASSWORD/SECRET/TOKEN/_PWD", () => {
        // Positive key-name cases
        expect(isSecret("onlylowercase", "API_KEY")).toBe(true);
        expect(isSecret("tiger123", "DB_PASS")).toBe(true);
        expect(isSecret("12345678", "ADMIN_PASSWORD")).toBe(true);
        expect(isSecret("mysecret", "JWT_SECRET")).toBe(true);
        expect(isSecret("simpletoken", "AUTH_TOKEN")).toBe(true);
        expect(isSecret("mysqlpass", "MYSQL_PWD")).toBe(true);
        expect(isSecret("550e8400-e29b-41d4-a716-446655440000", "SESSION_TOKEN")).toBe(true);

        // Negative key-name cases
        expect(isSecret("short77", "API_KEY")).toBe(false); // < 8 chars
        expect(isSecret("rsa-key-type", "KEY_TYPE")).toBe(false); // KEY is prefix, not suffix
        expect(isSecret("12345678", "KEY_SIZE")).toBe(false); // KEY is prefix, not suffix
        expect(isSecret("12345678", "TOKEN_TTL")).toBe(false); // TOKEN is prefix, not suffix
        expect(isSecret("enabled123", "PASS_THROUGH")).toBe(false); // PASS is prefix
        expect(isSecret("workdirname", "PWD")).toBe(false); // bare PWD (working dir) ignored
        expect(isSecret("/etc/ssl/private/key.pem", "SSL_KEY")).toBe(false); // file path ignored even with _KEY
        expect(isSecret("https://example.com/secret", "API_KEY")).toBe(false); // full URL ignored even with _KEY
        expect(isSecret("null", "API_KEY")).toBe(false); // < 8 chars
        expect(isSecret("false", "USE_KEY")).toBe(false); // < 8 chars
    });
});

describe("extractSecret", () => {
    it("extracts non-trivial passwords from URLs and ignores URLs without strong passwords", () => {
        // Positive URL cases
        expect(extractSecret("https://user:MyPass123@domain.com/uri")).toBe("MyPass123");
        expect(extractSecret("http://user:LocalPass123@127.0.0.1", "SERVICE_URL")).toBe("LocalPass123");
        expect(extractSecret("postgres://dbuser:D7s(bn`Z''1bQFI@db.internal:5432/prod", "DATABASE_URL")).toBe("D7s(bn`Z''1bQFI");
        expect(extractSecret("redis://:a1b2c3d4e5f60718@localhost:6379/0", "REDIS_URI")).toBe("a1b2c3d4e5f60718");

        // Negative URL cases
        expect(extractSecret("https://example.com/ApiV1/2026", "PUBLIC_URL")).toBeNull(); // no credentials
        expect(extractSecret("https://user@domain.com/ApiV1/2026", "PUBLIC_URL")).toBeNull(); // user only, no password
        expect(extractSecret("https://domain.com:8443/PathWith@AtSign1", "PUBLIC_URL")).toBeNull(); // port + @ in path, not userinfo
        expect(extractSecret("postgres://postgres:postgres@localhost:5432/db", "DATABASE_URL")).toBeNull(); // single-case alpha word
        expect(extractSecret("redis://:password@localhost:6379/0", "REDIS_URL")).toBeNull(); // single-case alpha word
        expect(extractSecret("postgres://user:Short1@localhost:5432/db", "DATABASE_URL")).toBeNull(); // < 8 chars
        expect(extractSecret("https://user:MyPass123@domain.com/uri", "UNRELATED_VAR")).toBeNull(); // key is not URL/URI/secret
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
            "DB_URL=postgres://admin:UrlPass99xyz@db.example.com:5432/app\nPUBLIC_URL=https://example.com/ApiV1/2026\n",
        );

        const loaded = loadSecrets(sub);
        // Raw secrets
        expect(loaded).toContain("RootSecret123");
        expect(loaded).toContain("D7s(bn`Z''/1bQFI");
        expect(loaded).toContain("UrlPass99xyz");
        // URL-encoded and base64 variants
        expect(loaded).toContain(encodeURIComponent("D7s(bn`Z''/1bQFI"));
        expect(loaded).toContain(Buffer.from("RootSecret123").toString("base64"));
        // Sorted longest-first
        for (let i = 1; i < loaded.length; i++) {
            expect(loaded[i - 1]!.length).toBeGreaterThanOrEqual(loaded[i]!.length);
        }
    });

    it("collects process env secrets for matching key names, URLs, and prefixes while ignoring system vars", () => {
        const loaded = loadSecrets(dir, {
            OPENAI_API_KEY: "envsecret",
            GITHUB_TOKEN: "ghp_1234567890abcdef",
            DATABASE_URL: "postgres://admin:EnvDbPass99@localhost:5432/app",
            UNNAMED_OPENAI: "sk-proj-1234567890abcdef",
            SSL_KEY: "/etc/ssl/private/server.key",
            TERM_SESSION_ID: "550e8400-e29b-41d4-a716-446655440000",
            GIT_COMMIT: "a1b2c3d4e5f60718",
            PUBLIC_URL: "https://example.com/ApiV1/2026",
        });
        expect(loaded).toContain("envsecret");
        expect(loaded).toContain("ghp_1234567890abcdef");
        expect(loaded).toContain("EnvDbPass99");
        expect(loaded).toContain("sk-proj-1234567890abcdef");
        expect(loaded).not.toContain("/etc/ssl/private/server.key");
        expect(loaded).not.toContain("550e8400-e29b-41d4-a716-446655440000");
        expect(loaded).not.toContain("a1b2c3d4e5f60718");
    });
});

describe("redact extension", () => {
    it("redacts raw, base64, URL-encoded, and PEM secrets in outbound context and emits a warning", async () => {
        const sub = join(dir, "nested");
        mkdirSync(sub);
        writeFileSync(
            join(dir, ".env"),
            "API_KEY=D7s(bn`Z''/1bQFI\nUUID_TOKEN=550e8400-e29b-41d4-a716-446655440000\nDB_URL=https://user:UrlSecr3t99@domain.com/uri\n",
        );
        writeFileSync(
            join(sub, ".env.local"),
            "HEX_KEY=deadbeefcafebabe01\nPORT=8080\nMODE=production\nNOTE=\"has spaces Ab1\"\n",
        );

        const b64 = Buffer.from("deadbeefcafebabe01").toString("base64");
        const urlEnc = encodeURIComponent("D7s(bn`Z''/1bQFI");
        const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU=\n-----END OPENSSH PRIVATE KEY-----";

        pi = startPi([REDACT_EXT], { cwd: sub });
        await pi.turn(
            `urlEnc=${urlEnc} b64=${b64} uuid=550e8400-e29b-41d4-a716-446655440000 url=https://user:UrlSecr3t99@domain.com/uri pem=${pem} port=8080 mode=production`,
        );

        expect(await pi.lastText()).toBe(
            `SEEN: urlEnc=${REDACTED} b64=${REDACTED} uuid=${REDACTED} url=https://user:${REDACTED}@domain.com/uri pem=${REDACTED} port=8080 mode=production`,
        );
        expect(pi.notifies).toEqual([
            { message: "🕵️ redact: Protecting 4 secrets", notifyType: "warning" },
            { message: "redact: Redacted secret in outbound LLM context", notifyType: "warning" },
        ]);
    });

    it("notifies with 0 secrets, redacts truncated PEM blocks without END marker, and reloads .env* on new_session", async () => {
        pi = startPi([REDACT_EXT], { cwd: dir });
        await pi.turn("before=NewSecretAddedLater99 head=-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA12345678");
        expect(await pi.lastText()).toBe(`SEEN: before=NewSecretAddedLater99 head=${REDACTED}`);
        expect(pi.notifies).toEqual([
            { message: "🕵️ redact: Protecting 0 secrets", notifyType: "warning" },
            { message: "redact: Redacted secret in outbound LLM context", notifyType: "warning" },
        ]);

        writeFileSync(join(dir, ".env.local"), "LATE_KEY=NewSecretAddedLater99\n");
        await pi.send({ type: "new_session" });
        await pi.turn("after=NewSecretAddedLater99");

        expect(await pi.lastText()).toBe(`SEEN: after=${REDACTED}`);
        expect(pi.notifies).toContainEqual({
            message: "🕵️ redact: Protecting 1 secret",
            notifyType: "warning",
        });
    });

    it("redacts secrets in tool results and notifies with a warning", async () => {
        writeFileSync(join(dir, ".env"), "SECRET_TOKEN=MyTopSecret99\n");
        writeFileSync(join(dir, "README.md"), "token is MyTopSecret99 here\n");

        pi = startPi([REDACT_EXT], { cwd: dir });
        await pi.turn("TOOLS"); // triggers bash `echo hi` and read `README.md`

        const msgs = (await pi.send({ type: "get_messages" })).data?.messages as any[];
        const readResult = msgs.find((m) => m.role === "toolResult" && m.toolName === "read");
        const text = readResult.content.map((c: any) => c.text).join("");
        expect(text).toContain(`token is ${REDACTED} here`);
        expect(text).not.toContain("MyTopSecret99");
        expect(pi.notifies).toEqual([
            { message: "🕵️ redact: Protecting 1 secret", notifyType: "warning" },
            { message: "redact: Redacted secret in read tool output", notifyType: "warning" },
        ]);
    });
});
