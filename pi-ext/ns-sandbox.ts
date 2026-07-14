/**
 * ns-sandbox: Linux user-namespace sandbox for pi's built-in tools.
 *
 * File tools are confined to the workspace. Bash runs in a fresh
 * user+mount+pid+ipc namespace (tmpfs root, pivot_root) with the
 * host cwd bind-mounted at its real path (rw,nosuid,nodev). /usr
 * and /etc are rbind'd ro. /run is NOT rbind'd; only a small set
 * of resolv.conf candidates is bound in so DNS still works via
 * the /etc/resolv.conf symlink.
 *
 * Requires: Linux, util-linux ≥ 2.36 (unshare + setpriv), and
 * unprivileged user namespaces enabled.
 *
 * Fail-closed. If the sandbox cannot enable, the extension exits
 * the process — no fallback to unsandboxed tools. The extension
 * file and /tmp workspaces are refused at session_start to stop
 * the model tampering with the sandbox.
 *
 *   pi -e ~/.pi/examples/extensions/ns-sandbox.ts [--airgap]
 */

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	type BashOperations,
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
	type EditOperations,
	type FindOperations,
	type GrepOperations,
	type LsOperations,
	type ReadOperations,
	type WriteOperations,
} from "@earendil-works/pi-coding-agent";

const SETUP_SCRIPT_NAME = "pi-ns-sandbox-setup.sh";

// Flags passed to `unshare` for every bash call. --map-root-user
// is required because mount(2) checks getuid()==0 before doing the
// syscall; the user command later drops into a nested unshare with
// --map-user=$HOST_UID to run as the host identity.
// --propagation=private keeps the tmpfs root from leaking to the
// host. --net is appended per-session when --airgap is passed.
// --mount-proc is intentionally absent: the setup script mounts
// /proc at NEWTMP/proc after pivot_root into the new root.
const UNSHARE_BASE_FLAGS = [
	"--user",
	"--map-root-user",
	"--mount",
	"--pid",
	"--fork",
	"--ipc",
	"--cgroup",
	"--propagation",
	"private",
];

// Real host UID/GID. Used by the setup script's nested unshare to
// map the user command back to the host identity (so `ls -l` shows
// the real owner, not namespace root).
const HOST_UID = process.getuid();
const HOST_GID = process.getgid();

// Extension source path; used to refuse enabling when the
// extension file is inside the jail (the model would then be
// able to edit it).
const SELF_FILE = fileURLToPath(import.meta.url);

// Setup script. $1 tmpfs mount point, $2 host path to bind-mount
// (fixed at load, not model-controlled), $3 model-controlled cwd
// (used post-pivot_root only), $4/$5 real host UID/GID. Builds a
// tmpfs root, rbind's /usr+/etc ro, mounts /dev and /proc, then
// pivot_root and exec's `setpriv --no-new-privs` -> nested
// unshare -U --map-user=$HOST_UID -> env -i -> bash.
const SETUP_SCRIPT = `#!/bin/bash
set -e
NEWTMP="$1"
# $2 host path bind-mounted (fixed at load, not model-controlled).
# $3 bash command cwd (model-controlled, used post-pivot_root).
# $4/$5 real host UID/GID (mapping for the nested unshare).
BIND_SOURCE="$2"
BASH_CWD="$3"
HOST_UID="$4"
HOST_GID="$5"
COMMAND=$(cat)
mount -t tmpfs tmpfs "$NEWTMP"
cd "$NEWTMP"
mkdir -p "$NEWTMP$BIND_SOURCE" tmp dev proc usr etc run
mount --bind "$BIND_SOURCE" "$NEWTMP$BIND_SOURCE"
mount -o remount,bind,rw,nosuid,nodev "$NEWTMP$BIND_SOURCE"
# Bind the host's real /tmp into the sandbox (nosuid,nodev).
mount --bind /tmp "$NEWTMP/tmp"
mount -o remount,bind,rw,nosuid,nodev "$NEWTMP/tmp"
mount --rbind /usr "$NEWTMP/usr"
mount -o remount,ro,bind "$NEWTMP/usr"
# Re-create the host's compatibility symlinks (merged-usr systems have
# /bin -> usr/bin, /lib -> usr/lib, /sbin -> usr/sbin, /lib64 -> usr/lib64).
# rmdir first because we just mkdir'd these in some setups.
for entry in bin sbin lib lib64; do
  if [ -L "/$entry" ]; then
    target=$(readlink "/$entry")
    rmdir "$NEWTMP/$entry" 2>/dev/null || rm -rf "$NEWTMP/$entry"
    ln -s "$target" "$NEWTMP/$entry"
  fi
done
# /run is NOT rbind'd: it would surface docker.sock, snapd, libvirt,
# systemd-resolved's D-Bus socket, /run/user/<uid>/{bus,wayland-0,
# pipewire-0}, and ssh-agent — all escalation vectors. DNS still
# works because /etc/resolv.conf is a symlink to a regular file
# inside /run, which the rbind of /etc brings along; the symlink
# resolves through NEWTMP/run/... to the file we just bound in.
# Only known resolv.conf candidates are bound in (regular files
# only); add new entries here to support more distros.
for target in \
	/run/systemd/resolve/stub-resolv.conf \
	/run/systemd/resolve/resolv.conf \
	/run/resolv.conf \
	/run/resolvconf/resolv.conf \
	/var/run/systemd/resolve/stub-resolv.conf \
	/var/run/systemd/resolve/resolv.conf; do
	[ -f "$target" ] || continue
	rel="\${target#/}"
	dst="$NEWTMP/$rel"
	mkdir -p "$(dirname "$dst")"
	: > "$dst"
	mount --bind "$target" "$dst"
	mount -o remount,ro,bind "$dst"
done
if [ -d /etc ]; then
  mount --rbind /etc "$NEWTMP/etc"
  mount -o remount,ro,bind "$NEWTMP/etc"
fi
mknod -m 666 "$NEWTMP/dev/null" c 1 3 2>/dev/null || true
mknod -m 666 "$NEWTMP/dev/zero" c 1 5 2>/dev/null || true
mknod -m 666 "$NEWTMP/dev/random" c 1 8 2>/dev/null || true
mknod -m 666 "$NEWTMP/dev/urandom" c 1 9 2>/dev/null || true
mount -t proc proc "$NEWTMP/proc"
mkdir "$NEWTMP/.old"
pivot_root "$NEWTMP" "$NEWTMP/.old"
cd "$BASH_CWD"
umount -l /.old 2>/dev/null || true
rmdir /.old 2>/dev/null || true
# Sanity check: the model can read /proc/1/environ, so the env
# in this process's memory is what it sees. \`env -i\` below
# replaces it with a whitelist; this fails fast if they drift.
if [ "\$(wc -c </proc/self/environ)" -gt 1024 ]; then
	echo "ns-sandbox setup: refusing to exec user command; inherited env too large (\$(wc -c </proc/self/environ) bytes). env -i is the only thing keeping /proc/1/environ from leaking the parent's API keys." >&2
	exit 1
fi
# Drop into a nested user namespace for the user command.
# --map-user to a non-zero UID strips the kernel-granted caps
# (which only apply at UID 0), so the user command has no caps
# and cannot unshare/mount/pivot_root/setns/use SUID helpers.
# --no-new-privs runs first (where we still have caps) so it
# doesn't strip them, and is inherited by every exec below.
# --bounding-set is intentionally not used: applying it requires
# CAP_SETPCAP, which we'd lose in the outer or never have in the
# inner. Cap-stripping from the UID mapping + no-new-privs
# already covers what --bounding-set would add.
exec /usr/bin/setpriv --no-new-privs \
	/usr/bin/unshare -U \
	--map-user="$HOST_UID" \
	--map-group="$HOST_GID" \
	/usr/bin/env -i \
	HOME=/tmp \
	SANDBOX=ns-sandbox \
	PATH="\${PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}" \
	LANG="\${LANG:-C.UTF-8}" \
	LC_ALL="\${LC_ALL:-C.UTF-8}" \
	TERM="\${TERM:-xterm-256color}" \
	PWD="$BASH_CWD" \
	/bin/bash -c "$COMMAND"
`;

function isInsideWorkspace(workspace: string, target: string): boolean {
	const rel = relative(workspace, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

const TMP_ROOT = "/tmp";

// Resolve a path against the workspace or /tmp, following symlinks at
// every existing component. The lexical check is necessary but not
// sufficient: a symlink can pass it while pointing outside
// (e.g. `ln -s ~/.ssh/id_rsa /tmp/key` from bash). We walk up the
// longest existing prefix, realpath it, re-join the remaining suffix,
// and re-check the canonical form is under one of the two roots. For a
// non-existent target, the deepest existing ancestor is canonicalized
// and the new suffix appended.
async function resolveInsideWorkspace(workspace: string, target: string): Promise<string> {
	const lexicallyAllowed =
		isInsideWorkspace(workspace, target) || target === TMP_ROOT || target.startsWith(`${TMP_ROOT}/`);
	if (!lexicallyAllowed) {
		throw new Error(`Refused: path is outside the sandbox workspace: ${target}`);
	}
	// /tmp in the sandbox is the host's /tmp — no translation needed.
	let existing = target;
	let suffix = "";
	for (;;) {
		let real: string;
		try {
			real = await realpath(existing);
		} catch {
			const parent = dirname(existing);
			if (parent === existing) {
				throw new Error(`Refused: cannot resolve path (no existing ancestor): ${target}`);
			}
			suffix = suffix ? join(basename(existing), suffix) : basename(existing);
			existing = parent;
			continue;
		}
		const resolved = suffix ? join(real, suffix) : real;
		if (!isInsideWorkspace(workspace, resolved) && !isInsideWorkspace(TMP_ROOT, resolved)) {
			throw new Error(`Refused: path resolves outside the sandbox workspace: ${target} -> ${resolved}`);
		}
		return resolved;
	}
}

function killChild(child: { pid?: number; kill(signal?: number | string): any }): void {
	if (!child.pid) return;
	try {
		process.kill(-child.pid, "SIGKILL");
	} catch {
		child.kill("SIGKILL");
	}
}

// Linux-only check, called once at session_start. Probes below assume Linux.
function assertLinux(): { ok: boolean; reason?: string } {
	if (process.platform === "linux") return { ok: true };
	return { ok: false, reason: `ns-sandbox is Linux-only (current: ${process.platform})` };
}

async function probeUnshare(): Promise<{ ok: boolean; reason?: string }> {
	return new Promise((resolveProbe) => {
		// Probe with the real flag set. util-linux < 2.36 lacks
		// --map-root-user and the user gets a clear reason to upgrade.
		const child = spawn(
			"unshare",
			["--user", "--map-root-user", "--mount", "/bin/true"],
			{ stdio: "ignore" },
		);
		child.on("error", () => resolveProbe({ ok: false, reason: "`unshare` not found on PATH" }));
		child.on("exit", (code) => {
			if (code === 0) {
				resolveProbe({ ok: true });
			} else {
				resolveProbe({
					ok: false,
					reason:
						"`unshare --user --map-root-user --mount` failed; either unprivileged user namespaces are disabled (check /proc/sys/kernel/unprivileged_userns_clone) or util-linux is older than 2.36 (2020) and lacks --map-root-user",
				});
			}
		});
	});
}

// Probe with --help only. The real --no-new-privs call must run
// inside the unshared namespace, so we cannot exercise it here.
// A setpriv older than 2.31/2017 will pass this and fail later
// at exec time with a visible setpriv error.
async function probeSetpriv(): Promise<{ ok: boolean; reason?: string }> {
	return new Promise((resolveProbe) => {
		const child = spawn("setpriv", ["--help"], { stdio: "ignore" });
		child.on("error", () =>
			resolveProbe({ ok: false, reason: "`setpriv` not found on PATH (ships with util-linux, same package as `unshare`)" }),
		);
		child.on("exit", (code) => {
			if (code === 0) {
				resolveProbe({ ok: true });
			} else {
				resolveProbe({
					ok: false,
					reason: "`setpriv --help` returned non-zero; util-linux is too old or corrupted (need ≥ 2.31 (2017) for --no-new-privs)",
				});
			}
		});
	});
}

// Static paths under /run/user/<uid>/ (tmpfs, never bind-mounted into
// the sandbox — see SETUP_SCRIPT). The setup script is rewritten on
// every call for defense-in-depth. Per-call tmpfs roots are created
// with mkdtemp under RUN_PREFIX.
const SETUP_SCRIPT_HOST_PATH = `/run/user/${HOST_UID}/${SETUP_SCRIPT_NAME}`;
const RUN_PREFIX = `/run/user/${HOST_UID}/pi-ns-`;

// Refuse to enable when the workspace is so broad that the
// "workspace is the cwd" confinement becomes meaningless. The
// bind-mount source is localCwd, so / or $HOME would give the
// model access to ~/.ssh, /etc, etc.
async function assertWorkspaceIsBounded(localCwd: string): Promise<void> {
	const home = process.env.HOME ? await realpath(process.env.HOME).catch(() => process.env.HOME) : undefined;
	const resolvedCwd = await realpath(localCwd).catch(() => localCwd);
	if (resolvedCwd === "/") {
		throw new Error(
			`ns-sandbox: refusing to enable — workspace is "/". Bind-mounting the entire host root gives the model read/write to /etc, /var, /root, and every user's home. ` +
			`Run pi from a project subdirectory.`,
		);
	}
	if (home && resolvedCwd === home) {
		throw new Error(
			`ns-sandbox: refusing to enable — workspace is $HOME (${home}). This would expose ~/.ssh, ~/.gnupg, browser profiles, etc. ` +
			`Run pi from a project subdirectory.`,
		);
	}
}

// Refuse to enable when the extension's source file is inside
// the workspace: the model would have read/write to it and could
// rewrite this check or the bind-mount source.
async function assertExtensionNotInWorkspace(localCwd: string, selfFile: string): Promise<void> {
	if (isInsideWorkspace(localCwd, selfFile)) {
		throw new Error(
			`this extension file (${selfFile}) is inside the sandboxed workspace (${localCwd}). ` +
			`The model can edit it and bypass the sandbox. Move the extension out of the project, or invoke pi from a different directory.`,
		);
	}
}

interface SandboxTestResult {
	name: string;
	pass: boolean;
	skipped: boolean;
	detail?: string;
	// Captured command output; truncated to 200 chars for the table.
	// On failure the full output goes in `detail`.
	stdout: string;
	stderr: string;
}

// Spawn one test through the same unshare+setup flow the agent's
// bash tool uses; assert against `test.expect`. Default 10s timeout.
async function runOneSandboxTest(
	bindSource: string,
	noNetwork: boolean,
	test: SandboxTest,
): Promise<SandboxTestResult> {
	if (test.skipWhenAirgap && noNetwork) {
		return { name: test.name, pass: true, skipped: true, stdout: "", stderr: "" };
	}
	const capture = { stdout: "", stderr: "" };
	try {
		const { exitCode, timedOut } = await runSandboxCommand(bindSource, noNetwork, {
			command: `${test.cmd}\nexit`, // trailing `exit` so any sub-bash the test spawns still terminates the run
			bashCwd: bindSource,         // tests force cwd == workspace; the real agent's cwd is whatever the model passes
			timeoutSeconds: test.timeoutSeconds ?? 10,
			capture,
		});
		// Truncate captured output for the table; the test name + status is
		// the primary signal, full output is recoverable from a failing
		// test's `detail` field.
		const trunc = (s: string) => s.length > 200 ? s.slice(0, 200) + "…" : s;
		const expectedExit = test.expect.exit ?? 0;
		const fail = (msg: string): SandboxTestResult => ({
			name: test.name, pass: false, skipped: false,
			stdout: trunc(capture.stdout), stderr: trunc(capture.stderr), detail: msg,
		});
		if (timedOut) return fail(`timeout after ${(test.timeoutSeconds ?? 10)}s`);
		if (exitCode !== expectedExit) return fail(`expected exit ${expectedExit}, got ${exitCode}`);
		if (test.expect.stdoutIncludes && !capture.stdout.includes(test.expect.stdoutIncludes)) {
			return fail(`expected stdout to include ${JSON.stringify(test.expect.stdoutIncludes)}`);
		}
		if (test.expect.stdoutExcludes && capture.stdout.includes(test.expect.stdoutExcludes)) {
			return fail(`expected stdout to NOT include ${JSON.stringify(test.expect.stdoutExcludes)}`);
		}
		return { name: test.name, pass: true, skipped: false, stdout: trunc(capture.stdout), stderr: trunc(capture.stderr) };
	} catch (err) {
		return { name: test.name, pass: false, skipped: false, stdout: "", stderr: "", detail: err instanceof Error ? err.message : String(err) };
	}
}

// Run the self-test suite. Triggered by `pi --sandbox-test`.
// Reports to stdout and UI, then process.exit(0|1).
async function runSandboxTestSuite(
	localCwd: string,
	noNetwork: boolean,
	ctx: { ui: { notify: (msg: string, kind: "info" | "error") => void } },
): Promise<void> {
	const header = `ns-sandbox: self-test on ${localCwd}${noNetwork ? " (--airgap)" : ""}`;
	process.stdout.write(`${header}\n`);
	const results: SandboxTestResult[] = [];
	for (const test of SANDBOX_TESTS) {
		// Mark "skipped" inline so the row is unambiguous.
		const result = await runOneSandboxTest(localCwd, noNetwork, test);
		results.push(result);
		const mark = result.skipped ? "⏭" : result.pass ? "✓" : "✗";
		const suffix = result.skipped ? " [skipped: --airgap]"
			: result.pass ? ""
			: ` — ${result.detail ?? "failed"}`;
		process.stdout.write(`  ${mark} ${result.name}${suffix}\n`);
		if (!result.pass && !result.skipped) {
			if (result.stdout) process.stdout.write(`      stdout: ${JSON.stringify(result.stdout)}\n`);
			if (result.stderr) process.stdout.write(`      stderr: ${JSON.stringify(result.stderr)}\n`);
		}
	}
	const passed = results.filter((r) => r.pass && !r.skipped).length;
	const failed = results.filter((r) => !r.pass && !r.skipped).length;
	const skipped = results.filter((r) => r.skipped).length;
	const summary = `${passed} passed, ${failed} failed, ${skipped} skipped`;
	process.stdout.write(`ns-sandbox: ${summary}\n`);
	if (failed > 0) {
		ctx.ui.notify(`ns-sandbox: self-test FAILED — ${summary}`, "error");
		process.exit(1);
	}
	ctx.ui.notify(`ns-sandbox: self-test passed — ${summary}`, "info");
	process.exit(0);
}

// Spawn/kill/capture loop shared by the bash tool and the
// self-test suite. Output is either streamed via `onChunk` or
// captured into `capture` buffers; the two are mutually exclusive.
interface SandboxRunOptions {
	command: string;
	bashCwd: string;
	signal?: AbortSignal;
	timeoutSeconds?: number;
	onChunk?: (chunk: Buffer) => void;
	capture?: { stdout: string; stderr: string };
}
interface SandboxRunResult {
	exitCode: number;
	timedOut: boolean;
}

async function runSandboxCommand(
	bindSource: string,
	noNetwork: boolean,
	opts: SandboxRunOptions,
): Promise<SandboxRunResult> {
	if (opts.signal?.aborted) {
		throw new Error("aborted");
	}
	if (!opts.bashCwd) {
		// Fail-fast guard. The bash tool always passes a cwd; the
		// bind-mount source is localCwd (extension load), not cwd.
		throw new Error("ns-sandbox: bash tool called without a cwd");
	}
	// bindSource is the host path bind-mounted into the namespace;
	// fixed at extension load, never model-controlled. The model's
	// cwd is the bash command's working dir post-pivot_root.
	const flags = noNetwork ? [...UNSHARE_BASE_FLAGS, "--net"] : UNSHARE_BASE_FLAGS;
	// Defense in depth: rewrite the setup script on every call. If
	// the LLM ever reaches /run, any tamper is overwritten before
	// exec. The rm-then-write defeats symlink/FIFO substitution and
	// the "writeFile only sets mode on create" perm-change attack.
	const setupPath = SETUP_SCRIPT_HOST_PATH;
	await mkdir(dirname(setupPath), { recursive: true });
	await rm(setupPath, { force: true });
	await writeFile(setupPath, SETUP_SCRIPT, { mode: 0o700 });
	const runDir = await mkdtemp(`${RUN_PREFIX}${opts.capture ? "test-" : "run-"}XXXXXX`);
	// Clean up runDir after the process settles. Handles EBUSY
	// (tmpfs still mounted) and failed-setup stragglers.
	try {
		return await new Promise<SandboxRunResult>((resolveRun, rejectRun) => {
			const child = spawn(
				"unshare",
				[
					...flags, "--",
					"/bin/bash", SETUP_SCRIPT_HOST_PATH,
					runDir, bindSource, opts.bashCwd,
					String(HOST_UID), String(HOST_GID),
				],
				{ detached: true, stdio: ["pipe", "pipe", "pipe"] },
			);
			// Send the command via stdin. Closes on child end.
			child.stdin?.on("error", () => {});
			child.stdin?.end(`${opts.command}\n`);
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			if (opts.timeoutSeconds !== undefined && opts.timeoutSeconds > 0) {
				timeoutHandle = setTimeout(() => {
					timedOut = true;
					killChild(child);
				}, opts.timeoutSeconds * 1000);
			}
			child.stdout?.on("data", (d: Buffer) => {
				if (opts.capture) opts.capture.stdout += d.toString();
				else if (opts.onChunk) opts.onChunk(d);
			});
			child.stderr?.on("data", (d: Buffer) => {
				if (opts.capture) opts.capture.stderr += d.toString();
				else if (opts.onChunk) opts.onChunk(d);
			});
			const onAbort = () => { killChild(child); };
			opts.signal?.addEventListener("abort", onAbort, { once: true });
			child.on("error", (err) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				opts.signal?.removeEventListener("abort", onAbort);
				rejectRun(err);
			});
			child.on("close", (code) => {
				if (timeoutHandle) clearTimeout(timeoutHandle);
				opts.signal?.removeEventListener("abort", onAbort);
				if (opts.signal?.aborted) {
					rejectRun(new Error("aborted"));
				} else {
					resolveRun({ exitCode: code ?? 1, timedOut });
				}
			});
		});
	} finally {
		rm(runDir, { recursive: true, force: true }).catch(() => {});
	}
}

function makeBashOps(localCwd: string, noNetwork: boolean): BashOperations {
	return {
		exec(command, cwd, { onData, signal, timeout }) {
			return runSandboxCommand(localCwd, noNetwork, {
				command,
				bashCwd: cwd,
				signal,
				timeoutSeconds: timeout,
				onChunk: onData,
			}).then(({ exitCode, timedOut }) => {
				if (timedOut) throw new Error(`timeout:${timeout}`);
				return { exitCode };
			});
		},
	};
}

function makeReadOps(workspace: string): ReadOperations {
	return {
		readFile: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, absolutePath);
			return readFile(safe);
		},
		access: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, absolutePath);
			await access(safe, constants.R_OK);
		},
	};
}

function makeWriteOps(workspace: string): WriteOperations {
	return {
		writeFile: async (absolutePath, content) => {
			const safe = await resolveInsideWorkspace(workspace, absolutePath);
			// fs.writeFile doesn't create intermediate dirs; the model
			// shouldn't have to mkdir before writing to /tmp/whatever.
			await mkdir(dirname(safe), { recursive: true });
			await writeFile(safe, content, "utf-8");
		},
		mkdir: async (dir) => {
			const safe = await resolveInsideWorkspace(workspace, dir);
			await mkdir(safe, { recursive: true });
		},
	};
}

function makeEditOps(workspace: string): EditOperations {
	return { ...makeReadOps(workspace), ...makeWriteOps(workspace) };
}

function makeGrepOps(workspace: string): GrepOperations {
	return {
		isDirectory: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, absolutePath);
			return (await stat(safe)).isDirectory();
		},
		readFile: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, absolutePath);
			return readFile(safe, "utf-8");
		},
	};
}

async function existsOp(workspace: string, absolutePath: string): Promise<boolean> {
	try {
		const safe = await resolveInsideWorkspace(workspace, absolutePath);
		await access(safe, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

// Match a relative path against a find-tool glob pattern. Mirrors fd's
// behaviour: a pattern with no '/' matches basenames; a pattern with '/'
// matches the full relative path, with an implicit '**/' prefix so a
// leading "src/" still matches under any subdir.
function matchesToolGlob(relativePath: string, pattern: string): boolean {
	const normalized = pattern.split(sep).join("/");
	if (normalized.includes("/")) {
		return posix.matchesGlob(relativePath, normalized) ||
			posix.matchesGlob(relativePath, `**/${normalized}`);
	}
	return posix.matchesGlob(posix.basename(relativePath), normalized);
}

function makeFindOps(workspace: string): FindOperations {
	return {
		exists: (p) => existsOp(workspace, p),
		glob: async (pattern, cwd, options) => {
			// `cwd` is what the model sees (workspace or /tmp/...);
			// `safeRoot` is the real on-disk location. Walk safeRoot,
			// return paths rooted at cwd — otherwise the find tool's
			// `relative(cwd, p)` postproc leaks internal paths.
			const safeRoot = await resolveInsideWorkspace(workspace, cwd);
			// Skip the default ignore set at the directory level (cheaper
			// than per-file match) and refuse to follow symlinks — lstat
			// already does, and a target outside the workspace would
			// silently expand the search.
			const skipNames = new Set(["node_modules", ".git"]);
			const results: string[] = [];
			const visit = async (dir: string): Promise<void> => {
				if (results.length >= options.limit) return;
				let entries: string[];
				try { entries = await readdir(dir); } catch { return; }
				for (const name of entries) {
					if (results.length >= options.limit) return;
					const full = join(dir, name);
					let st;
					try { st = await lstat(full); } catch { continue; }
					if (st.isSymbolicLink()) continue;
					if (st.isDirectory()) {
						if (skipNames.has(name)) continue;
						await visit(full);
					} else if (st.isFile() && matchesToolGlob(relative(safeRoot, full), pattern)) {
						results.push(join(cwd, relative(safeRoot, full)));
					}
				}
			};
			await visit(safeRoot);
			return results;
		},
	};
}

function makeLsOps(workspace: string): LsOperations {
	return {
		exists: (p) => existsOp(workspace, p),
		stat: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, absolutePath);
			return stat(safe);
		},
		readdir: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, absolutePath);
			return readdir(safe);
		},
	};
}

interface SandboxTest {
	name: string;
	cmd: string;
	expect: {
		exit?: number; // 0 by default
		stdoutIncludes?: string;
		stdoutExcludes?: string;
	};
	skipWhenAirgap?: boolean;
	timeoutSeconds?: number;
}

const SANDBOX_TESTS: SandboxTest[] = [
	{
		name: "/etc is rbind'd (resolv.conf resolves)",
		cmd: "test -r /etc/resolv.conf && head -1 /etc/resolv.conf",
		expect: { stdoutExcludes: "No such file" },
	},
	{
		name: "/usr is rbind'd (binaries reachable)",
		cmd: "/usr/bin/id -u",
		expect: { stdoutIncludes: "0" },
	},
	{
		name: "/run/docker.sock is not reachable",
		cmd: "test ! -e /run/docker.sock",
		expect: { exit: 0 },
	},
	{
		name: "/home/user/.ssh is not reachable",
		cmd: "test ! -e /home/user/.ssh",
		expect: { exit: 0 },
	},
	{
		name: "DNS works (getent hosts example.com)",
		cmd: "getent hosts example.com 2>&1 | head -1",
		expect: { stdoutExcludes: "not found" },
	},
	{
		name: "TLS + reachability (curl https://example.com/)",
		cmd: "command -v curl >/dev/null && curl -sSf --max-time 5 -o /dev/null -w '%{http_code}' https://example.com/ || echo CURL_FAILED",
		expect: { stdoutIncludes: "200", stdoutExcludes: "CURL_FAILED" },
		skipWhenAirgap: true,
	},
	{
		name: "workspace is read-write",
		cmd: "echo ns-sandbox-test-can-write > /tmp/ns-sandbox-test.txt && cat /tmp/ns-sandbox-test.txt",
		expect: { stdoutIncludes: "ns-sandbox-test-can-write" },
	},
];

export default function (pi: ExtensionAPI) {
	pi.registerFlag("airgap", {
		description: "Drop network access from the bash sandbox (unshare --net)",
		type: "boolean",
		default: false,
	});
	pi.registerFlag("sandbox-test", {
		description: "Run a smoke-test suite at session_start to verify the sandbox is functional on this host, then exit",
		type: "boolean",
		default: false,
	});

	const localCwd = process.cwd();
	// Deferred to session_start because pi.getActiveTools() throws before the runtime is bound.
	let noNetwork = false;
	let runSandboxTests = false;

	let sandboxReady = false;

	// Each entry: [tool name, base tool (built-in), factory(localCwd, noNetwork) -> sandboxed tool].
	// Adding a new tool is one line; the loop below wires label, execute guard, and the active-set filter.
	const TOOL_OVERRIDES: ReadonlyArray<readonly [string, any, (cwd: string, noNet?: boolean) => any]> = [
		["bash", createBashTool(localCwd), (cwd, noNet) => createBashTool(cwd, { operations: makeBashOps(cwd, noNet!) })],
		["read", createReadTool(localCwd), (cwd) => createReadTool(cwd, { operations: makeReadOps(cwd) })],
		["write", createWriteTool(localCwd), (cwd) => createWriteTool(cwd, { operations: makeWriteOps(cwd) })],
		["edit", createEditTool(localCwd), (cwd) => createEditTool(cwd, { operations: makeEditOps(cwd) })],
		["grep", createGrepTool(localCwd), (cwd) => createGrepTool(cwd, { operations: makeGrepOps(cwd) })],
		["find", createFindTool(localCwd), (cwd) => createFindTool(cwd, { operations: makeFindOps(cwd) })],
		["ls", createLsTool(localCwd), (cwd) => createLsTool(cwd, { operations: makeLsOps(cwd) })],
	];

	// Populated by the session_start loop; used by the `sandbox` status command.
	const sandboxedTools: string[] = [];

	pi.on("session_start", async (_event, ctx) => {
		const linuxCheck = assertLinux();
		const failed: { reason?: string }[] = linuxCheck.ok ? [] : [linuxCheck];
		const checks = await Promise.all([probeUnshare(), probeSetpriv()]);
		for (const c of checks) if (!c.ok) failed.push(c);
		if (failed.length > 0) {
			const reasons = failed.map((c) => `  - ${c.reason}`).join("\n");
			const message = `ns-sandbox: cannot enable — preflight check${failed.length > 1 ? "s" : ""} failed:\n${reasons}\n\nFix the host or remove the ns-sandbox extension from your pi command.`;
			// Print to stderr so the user sees it even if the UI notify
			// is lost during shutdown.
			console.error(message);
			ctx.ui.notify(message, "error");
			process.exit(1);
		}
		try {
			await assertWorkspaceIsBounded(localCwd);
			await assertExtensionNotInWorkspace(localCwd, SELF_FILE);
			noNetwork = Boolean(pi.getFlag("airgap"));
			runSandboxTests = Boolean(pi.getFlag("sandbox-test"));
			sandboxReady = true;
			const activeTools = new Set(pi.getActiveTools());

			for (const [name, base, build] of TOOL_OVERRIDES) {
				if (!activeTools.has(name)) continue;
				const sandboxed = name === "bash" ? build(localCwd, noNetwork) : build(localCwd);
				pi.registerTool({
					...base,
					label: `${name} (sandboxed)`,
					async execute(...args: any[]) {
						if (!sandboxReady) throw new Error(`ns-sandbox: ${name} (sandboxed) called but sandbox is not initialised`);
						return sandboxed.execute(...args);
					},
				});
				sandboxedTools.push(name);
			}
			ctx.ui.setStatus("ns-sandbox", ctx.ui.theme.fg("accent", `ns-sandbox: ${localCwd}`));
			ctx.ui.notify(
				`ns-sandbox: active. Bash runs in a Linux user-namespace; ${localCwd} is bind-mounted at its host path (nosuid,nodev); /usr and /etc are read-only; other host paths are hidden.`,
				"info",
			);
			if (runSandboxTests) {
				// runSandboxTestSuite calls process.exit on its own; control does not return.
				await runSandboxTestSuite(localCwd, noNetwork, ctx);
			}
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			const message = `ns-sandbox: cannot enable — ${reason}`;
			console.error(message);
			ctx.ui.notify(message, "error");
			// process.exit(1) — not a throw. The runner would catch a
			// throw and fall back to the built-in unsandboxed tools,
			// which is exactly the failure mode we refuse to allow.
			process.exit(1);
		}
	});

	pi.on("session_shutdown", async () => {
		sandboxReady = false;
	});

	// `!` shell command hook. Always sandbox: opting into this extension
	// is the consent signal, not inclusion of "bash" in --tools.
	// Until session_start completes (sandboxReady false) this is a no-op.
	pi.on("user_bash", (_event, _ctx) => {
		if (!sandboxReady) return undefined;
		return { operations: makeBashOps(localCwd, noNetwork) };
	});

	// Update the working-directory hint in the system prompt.
	pi.on("before_agent_start", async (event) => {
		if (!sandboxReady) return undefined;
		const hostLine = `Current working directory: ${localCwd}`;
		const guestLine = `Current working directory: ${localCwd} (ns-sandbox: Linux user-namespace; the same path is visible inside bash with nosuid,nodev; /usr and /etc are read-only; other host paths are hidden)`;
		const systemPrompt = event.systemPrompt.includes(hostLine)
			? event.systemPrompt.replace(hostLine, guestLine)
			: `${event.systemPrompt}\n\n${guestLine}`;
		return { systemPrompt };
	});

	pi.registerCommand("sandbox", {
		description: "Show ns-sandbox status",
		handler: async (_args, ctx) => {
			const lines = sandboxReady
				? [
						"ns-sandbox: active",
						`Sandbox cwd: ${localCwd} (same as host cwd)`,
						`Setup script: ${SETUP_SCRIPT_HOST_PATH}`,
						`Sandboxed overrides: ${sandboxedTools.join(", ") || "(none active)"}`,
						`Network: ${noNetwork ? "disabled (--net)" : "host (inherited)"}`,
						"User `!` commands are sandboxed.",
					]
				: [
						"ns-sandbox: initialising",
						"Wait for session_start to complete. If it fails, pi will exit with an error.",
					];
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}

// Named exports for direct programmatic testing. pi loads the default
// export; these let a Node test exercise the file-tool realpath path
// without standing up a full pi session.
export {
	isInsideWorkspace,
	makeBashOps,
	makeEditOps,
	makeFindOps,
	makeGrepOps,
	makeLsOps,
	makeReadOps,
	makeWriteOps,
	matchesToolGlob,
	probeSetpriv,
	probeUnshare,
	resolveInsideWorkspace,
	runOneSandboxTest,
	runSandboxTestSuite,
};
export type { SandboxTest, SandboxTestResult };
