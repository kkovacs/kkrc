/**
 * ns-sandbox Extension - Linux user-namespace sandbox for built-in tools.
 *
 * Host pi; the file tools (read, write, edit, grep, find, ls) are
 * constrained to the current working directory, and bash runs in a
 * Linux user-namespace so the model can only modify the workspace
 * even though it can see /usr, /etc, /dev, /proc, /tmp. Bash runs
 * inside a fresh user + mount + PID + IPC namespace built with
 * `unshare`, `pivot_root`, and a tmpfs root. The host cwd is
 * bind-mounted at its actual host path (so `cd /home/user/project1`
 * just works) with nosuid, nodev. /usr and /etc are bind-mounted
 * read-only from the host (so binaries and /etc/passwd are visible,
 * but not writable). The host's /run is not rbind'd: every daemon
 * socket under it (docker.sock, snapd.socket, libvirt-sock,
 * podman.sock, /run/systemd/resolve/io.systemd.Resolve,
 * /run/user/<uid>/{bus,wayland-0,pipewire-0}, ...) is unreachable.
 * A small set of resolv.conf candidate files is bound in under
 * /run/systemd/resolve/, /run/, and /run/resolvconf/ so DNS works
 * on systemd-resolved hosts: the rbind of /etc below brings the
 * /etc/resolv.conf symlink along, and that symlink resolves through
 * NEWTMP/run/... to the regular file we just bound in. Nothing else
 * under /run is reachable. Everything else from the host (other
 * paths under /home, /var, /opt, /root, ssh keys, ...) is invisible.
 *
 * No install. Requires:
 *   - Linux
 *   - `unshare` on PATH (util-linux, preinstalled on every distro)
 *   - `setpriv` on PATH (util-linux, same package as `unshare`; only
 *     used to set --no-new-privs on the exec chain leading to the
 *     user command)
 *   - Unprivileged user namespaces enabled
 *     (default on Debian/Ubuntu/Fedora/Arch; some hardened distros disable)
 *
 * Host assumption for the sandbox to hold. If this is false, the model
 * can DoS other processes on the host:
 *   - The host may have delegated cgroup controllers (memory, pids, ...)
 *     to this user. If so, the model can write to its own cgroup from
 *     inside the namespace. --cgroup in UNSHARE_BASE_FLAGS limits this
 *     to the model's own cgroup view, so the blast radius is the
 *     processes in whatever cgroup the user was in at session start
 *     (usually just the user's own session). To eliminate the risk
 *     entirely, remove the user's delegated controllers.
 *
 * Failure mode (HARD requirement):
 *   This extension either provides sandboxed tools or it does not run.
 *   There is no fallback, emulation, or silent routing to pi's built-in
 *   unsandboxed tools. If the sandbox cannot enable — a host assumption
 *   above is violated, the setup script cannot be written, or any
 *   other initialization step fails — the extension prints the reason
 *   to stderr, notifies the UI, and calls process.exit(1) (it does
 *   NOT throw, because the runner would catch that and fall back to
 *   the built-in tools). The user must either fix the host assumption
 *   or remove the ns-sandbox extension from their pi command. A soft
 *   fallback to unsandboxed tools is explicitly out of scope: opting
 *   in to the sandbox means the agent does not run unsandboxed by
 *   accident.
 *
 * Usage:
 *   cd /path/to/project
 *   pi -e ./ns-sandbox
 *   pi -e ./ns-sandbox --airgap              # also drop network access
 *   (omit the extension entirely to skip the sandbox)
 *
 * Behaviour notes:
 *   - File tools validate that paths resolve inside the workspace and
 *     fail closed on anything else.
 *   - Bash is spawned once per call via `unshare ... bash setup.sh`.
 *     The setup script does the pivot_root; commands are sent via stdin
 *     to avoid shell-quoting issues.
 *   - Network access is inherited from the host. The user can `npm install`,
 *     `git clone`, etc. To isolate the network, pass `--airgap` (this
 *     appends `--net` to the unshare flags at spawn time).
 *   - The default `!` user-bash path is also routed through the sandbox.
 *
 * Security notes:
 *   - The bind-mount source is fixed at extension load (`localCwd`) and
 *     is never taken from the model's bash `cwd`. The model's `cwd` is
 *     used as the in-namespace bash working directory after `pivot_root`
 *     only, where any shell-injection impact is bounded by the mount
 *     namespace.
 *   - Two-stage user namespace. The outer `unshare --user --map-root-user
 *     --mount ...` runs the setup script as namespace root. This is
 *     required because the `mount` binary in util-linux does its own
 *     `getuid() == 0` pre-syscall check (and so do `mknod`,
 *     `pivot_root`, etc.); inside a 1:1-mapped namespace the setup
 *     would fail with "must be superuser to use mount" before any
 *     pivot_root could run. The user command does NOT execute in this
 *     outer namespace. At the end of the setup script we
 *     `unshare -U --map-user=$REAL_UID --map-group=$REAL_GID` into a
 *     nested user namespace where the calling process's UID is mapped
 *     to $REAL_UID. Because the mapping is to a non-zero UID, the
 *     kernel strips capabilities on entry to the inner — see the
 *     "model runs as a true unprivileged user" bullet below. The model
 *     ends up as its own UID, so `ls -l` inside the sandbox shows its
 *     own UID against the files it owns on the host — same UX as a 1:1
 *     outer mapping — without any setup-time tool having to bypass the
 *     `mount` binary's UID check.
 *   - The model runs as a true unprivileged user inside the inner
 *     namespace. The `--map-user=$REAL_UID` mapping places it at
 *     UID $REAL_UID (not 0), and the kernel strips all capabilities
 *     from a non-root process on entry to a fresh user namespace;
 *     the "namespace owner has all caps" grant only applies at
 *     UID 0. So the user command has no CAP_SYS_ADMIN (cannot
 *     `unshare` itself deeper, cannot mount/remount/pivot_root,
 *     cannot setns(2) into another namespace), no capability at
 *     all in fact, and cannot elevate via SUID, file caps, or
 *     `fusermount`. `--no-new-privs` (set on the outer setpriv,
 *     inherited through the unshare + exec chain) blocks file-cap
 *     and SUID elevation as a second layer. We do NOT clamp
 *     the bounding set explicitly: the cap-stripping by the
 *     --map-user mapping already removes everything we'd want the
 *     clamp to remove, and trying to apply the clamp in the outer
 *     (where we have CAP_SETPCAP) would strip CAP_SYS_ADMIN that
 *     the subsequent `unshare` needs, while trying to apply it in
 *     the inner (where the model is unprivileged) would fail for
 *     lack of CAP_SETPCAP.
 *   - The workspace and /tmp are mounted exec-capable (no `noexec`).
 *     This is intentional: a `noexec` mount would break common
 *     workflows (running build outputs, `node_modules/.bin`,
 *     downloaded scripts). The trade-off is that a binary dropped
 *     into the workspace by the model can be run directly. The
 *     cap-stripping in the inner namespace ensures such a binary
 *     cannot itself gain capabilities to do anything beyond what
 *     the model already has. See `sandbox-audit-2.md` for the full
 *     noexec trade-off.
 *   - `/dev/tty` is intentionally not created inside the namespace. It
 *     would resolve to the host's controlling terminal.
 *   - See `sandbox-audit-2.md` for the full threat model, including
 *     the userns-owned remount gap and the noexec trade-off.
 */

import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
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

// Flags passed to `unshare` for every bash call. --map-root-user makes
// the setup script run as namespace root, which is required because
// the `mount` binary in util-linux does its own `getuid() == 0` check
// before calling mount(2), and so do `mknod`, `pivot_root`, etc. The
// user command itself does NOT run in this outer namespace — the
// setup script's last step is `unshare -U --map-user=$REAL_UID
// --map-group=$REAL_GID` to enter a nested user namespace where the
// calling process is mapped to the real host UID, and
// `setpriv --no-new-privs` runs immediately before that to disable
// SUID/file-cap elevation across the rest of the exec chain. This
// keeps the "ls -l shows the model's own uid" UX that a 1:1 outer
// mapping would give, without making the setup steps fail their
// UID checks. SANDBOX=ns-sandbox is set in the env whitelist
// as a marker for processes that want to know they are sandboxed;
// USER is deliberately not set (the process is unprivileged) to
// avoid lying to tools that read USER for behavior. --propagation
// private keeps the new tmpfs root from leaking back to the host's
// mount tree. --ipc
// isolates SysV IPC, POSIX message queues, and abstract Unix sockets
// from the host. --cgroup isolates the cgroup namespace so the model
// cannot read host cgroup hierarchy. --net is appended per-session
// when the user passes --airgap. Requires util-linux ≥ 2.36 (2020)
// for --map-root-user; preinstalled on every current distro.
// --mount-proc is intentionally NOT in this list. The setup script mounts
// /proc itself at NEWTMP/proc after entering the new PID namespace, which
// is what the model actually sees post-pivot_root. The --mount-proc flag
// would only mount /proc at the *old* root, which is discarded at pivot.
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

// Real host UID/GID of the pi process. Used only as arguments to the
// setup script, which creates a nested user namespace mapping them
// back in before exec'ing the user command. process.getuid/getgid
// return the real (not effective) identity and are present on every
// Node build; they never throw on Linux. Captured once at module
// load; the pi process's UID/GID does not change for its lifetime.
const HOST_UID = process.getuid();
const HOST_GID = process.getgid();

// Absolute host path of this extension's source file. Captured at
// module load via import.meta.url (the file is loaded as ESM). Used
// in session_start to refuse to enable the sandbox when the
// extension file is inside the jail directory: the model would then
// be able to read and edit it, defeating the sandbox.
const SELF_FILE = fileURLToPath(import.meta.url);

// Shell script that runs inside the new namespace. It receives five
// arguments: $1 the per-call tmpfs mount point, $2 the host path to
// bind-mount (fixed at extension load, not from the model), $3 the
// bash command's working directory (model-controlled, used only
// post-pivot_root), and $4/$5 the real host UID/GID (passed to the
// final `unshare -U --map-user=...` so the model is mapped to its
// real host identity inside the nested user namespace, instead of
// running as the outer-namespace root). The script runs as
// namespace root for the setup phase (so the `mount` binary's
// `getuid() == 0` check passes), builds a new tmpfs root,
// bind-mounts the workspace at its actual host path
// (rw,nosuid,nodev) so absolute paths from the LLM keep working,
// read-only-binds the host's /usr (+ /bin /sbin /lib /lib64 as
// symlinks on merged-usr systems) and /etc, mounts a minimal /dev
// and /proc, pivot_roots into the new root, then execs into a
// nested user namespace for the user command.
//
// /tmp inside the namespace is bind-mounted to "${setupDir}/tmp" on
// the host, which is created eagerly by `session_start` (and also
// re-created here on first invocation as a safety net). That host
// dir is shared across every call in the same session, so files
// written to /tmp inside one call survive to the next.
// session_shutdown's rm -rf of setupDir cleans it up.
const SETUP_SCRIPT = `#!/bin/bash
set -e
NEWTMP="$1"
# $2 is the bind-mount source: the host path that gets bind-mounted into
# the namespace. It is fixed at extension load (localCwd) and never
# derived from the model's cwd, so the model cannot ask us to bind-mount
# an arbitrary host path (e.g. ~/.ssh) into the namespace.
BIND_SOURCE="$2"
# $3 is the bash command's working directory inside the namespace. It
# may be any path the model can reach through the namespace's mount
# tree; it is used only after pivot_root, so any shell-injection impact
# is bounded by the mount namespace.
BASH_CWD="$3"
# $4 and $5 are the real host UID and GID of the pi process. They are
# used only by the final \`unshare -U --map-user=$HOST_UID
# --map-group=$HOST_GID\`, which creates a nested user namespace
# mapping the calling process to that real host identity so the user
# command runs as the real UID/GID (preserving the \`ls -l\` ownership
# UX) instead of as the outer-namespace root. The earlier
# \`setpriv --no-new-privs\` does not change identity; it just sets
# PR_SET_NO_NEW_PRIVS across the rest of the exec chain.
HOST_UID="$4"
HOST_GID="$5"
COMMAND=$(cat)
HOST_TMP="$(dirname "$NEWTMP")/tmp"
mount -t tmpfs tmpfs "$NEWTMP"
cd "$NEWTMP"
mkdir -p "$NEWTMP$BIND_SOURCE" "$HOST_TMP" tmp dev proc usr etc run
mount --bind "$BIND_SOURCE" "$NEWTMP$BIND_SOURCE"
mount -o remount,bind,rw,nosuid,nodev "$NEWTMP$BIND_SOURCE"
# Per-session persistent /tmp: shared host dir so /tmp contents
# survive between bash calls. Same nosuid,nodev as the workspace.
# Skipped when the workspace itself lives under /tmp on the host, since
# the /tmp mount would shadow the workspace's path through the namespace.
case "$BIND_SOURCE" in
	/tmp|/tmp/*)
		;;
	*)
		mount --bind "$HOST_TMP" "$NEWTMP/tmp"
		mount -o remount,bind,rw,nosuid,nodev "$NEWTMP/tmp"
		;;
esac
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
# /run is intentionally NOT rbind-mounted. Binding the whole /run subtree
# would surface docker.sock, podman/podman.sock, snapd.socket, libvirt-sock,
# systemd/private, /run/user/<uid>/{bus,wayland-0,pipewire-0}, and systemd-
# resolved's io.systemd.Resolve D-Bus socket — all inward-facing escalation
# vectors the model has no business talking to.
#
# DNS still works because the only /etc path that reaches /run in practice
# is /etc/resolv.conf, a symlink to a regular file (typically
# /run/systemd/resolve/stub-resolv.conf on systemd-resolved hosts). The
# rbind of /etc below brings the symlink along; inside the namespace the
# symlink resolves through NEWTMP/run/... to the regular file we just
# bound in here. Nothing else under /run is reachable.
#
# We bring in only the known candidate files (regular files only; the
# [-f $target] test filters out sockets, devices, and symlinks). Adding
# a new entry here is how to support a distro that puts resolv.conf
# somewhere we don't list.
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
# Sanity check: the process is about to drop caps and become the user's
# bash. The model can read /proc/1/environ, so the env in this process's
# memory *is* what the model sees. \`env -i\` below replaces it with a
# whitelisted set; this assertion fails fast if that link is ever broken
# (e.g. someone adds an \`env\` step that re-injects parent env). Keep
# the two in sync.
if [ "\$(wc -c </proc/self/environ)" -gt 1024 ]; then
	echo "ns-sandbox setup: refusing to exec user command; inherited env too large (\$(wc -c </proc/self/environ) bytes). env -i is the only thing keeping /proc/1/environ from leaking the parent's API keys." >&2
	exit 1
fi
# Drop into a nested user namespace for the user command. The outer
# namespace (where this script has been running as root) is never
# re-entered — the user command inherits the inner namespace's view,
# and the inner is what we secure.
#
# \`unshare -U --map-user=$HOST_UID --map-group=$HOST_GID\` creates a
# nested user namespace whose only mapping is the real host UID/GID.
# Because the mapping is to a non-zero UID, the kernel strips the
# process's effective/permitted/inheritable capability sets on entry
# to the inner (the "namespace owner has all caps" grant only applies
# at UID 0). The user command therefore runs as a true unprivileged
# user: no CAP_SYS_ADMIN, so it cannot \`unshare\` itself deeper, mount,
# remount, pivot_root, or setns(2) into another namespace; no caps
# at all, so it cannot use SUID helpers, file-cap binaries, or
# \`fusermount\` even if the host user is in the \`fuse\` group.
# \`ls -l\` shows the model's real UID against the files it owns on
# the host.
#
# \`setpriv --no-new-privs\` runs first, in the outer namespace where
# we still have caps. PR_SET_NO_NEW_PRIVS does not require any
# capability, so it doesn't strip them, and no-new-privs is then
# inherited by the \`unshare\` process, the \`env\` process, and finally
# bash and the user command. This blocks file-cap and SUID elevation
# paths inside the inner.
#
# We deliberately do NOT pass \`--bounding-set\` here. The bounding
# set is normally applied alongside --no-new-privs as a second
# cap-restricting layer, but it can only be applied where we hold
# CAP_SETPCAP — the outer (where we have it) loses CAP_SYS_ADMIN
# when the bounding set is applied, and the inner (where we are
# UID $HOST_UID) has no caps at all. Either order breaks one of the
# two. With the model stripped of caps by the --map-user mapping
# and protected by no-new-privs, the bounding set is redundant; the
# only thing it would add is hardening against a kernel bug, and
# the same hardening is provided by the cap-stripping itself.
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

// Resolve a path against the workspace or the per-session persistent
// /tmp, following symlinks at every existing component. The lexical
// check is necessary but not sufficient: a path string can pass the
// lexical test while pointing at a symlink that escapes (e.g.
// `ln -s ~/.ssh/id_rsa /tmp/key` from inside the sandboxed bash). We
// walk up the longest existing prefix, realpath it, re-join the
// remaining suffix, and re-check the canonical form is under one of
// the two roots. For a target that does not exist yet (e.g. a file
// being created), the deepest existing ancestor is canonicalized and
// the new suffix appended.
async function resolveInsideWorkspace(workspace: string, setupDir: string, target: string): Promise<string> {
	const persistentTmp = join(setupDir, "tmp");
	const lexicallyAllowed =
		isInsideWorkspace(workspace, target) || target === TMP_ROOT || target.startsWith(`${TMP_ROOT}/`);
	if (!lexicallyAllowed) {
		throw new Error(`Refused: path is outside the sandbox workspace: ${target}`);
	}
	// /tmp/... is rewritten to setupDir/tmp/... so the file tools share the
	// same backing dir that bash's namespace /tmp is bind-mounted from. The
	// model sees /tmp/foo; the file tools operate on setupDir/tmp/foo.
	const translated =
		target === TMP_ROOT ? join(setupDir, "tmp") :
		target.startsWith(`${TMP_ROOT}/`) ? join(setupDir, "tmp", target.slice(TMP_ROOT.length + 1)) :
		target;
	let existing = translated;
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
		if (!isInsideWorkspace(workspace, resolved) && !isInsideWorkspace(persistentTmp, resolved)) {
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
		// Probe with the same flag style the sandbox actually uses. If
		// --map-root-user is not supported (util-linux < 2.36) the probe
		// fails, and the user sees a clear reason to upgrade rather than
		// a confusing runtime failure mid-session.
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

// Check that `setpriv` is available with the option the sandbox uses.
// setpriv is from util-linux (same package as unshare on every
// distribution), so the unshare probe usually implies it is there,
// but we verify separately so a missing setpriv gets a precise diagnostic
// rather than a generic "permission denied" from inside the namespace.
//
// We probe with `--help` rather than --no-new-privs because the
// real call must run inside the unshared namespace (it has to be
// applied to the process that becomes the user command), and the
// --help invocation confirms only that the binary is present and
// runnable. A wrong-version setpriv (older than 2.31 / 2017) that
// supports --help but not --no-new-privs would pass this probe and
// then surface as a setpriv error printed to the bash tool's output.
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

async function writeSetupScript(): Promise<{ dir: string; path: string }> {
	// Hardcoded /tmp (not os.tmpdir()) because setupDir is the host
	// location of the setup script and the per-call NEWTMP mount
	// point. If localCwd were /tmp, the bind-mount would expose
	// setupDir to the LLM, letting it tamper with the setup script or
	// pre-plant files in NEWTMP. assertWorkspaceIsBounded refuses /tmp
	// for the same reason — the two are complementary. Per-call
	// rewrite in runSandboxCommand is the deeper defense in depth.
	const dir = await mkdtemp("/tmp/pi-ns-sandbox-XXXXXX");
	const path = join(dir, SETUP_SCRIPT_NAME);
	await writeFile(path, SETUP_SCRIPT, { mode: 0o700 });
	return { dir, path };
}

// Refuse to enable the sandbox when the chosen workspace is so broad
// that "the workspace is the cwd" stops being a useful confinement.
// The bind-mount source is localCwd; if that's `/` or the user's
// $HOME, the model gets to read and write essentially everything on
// the host (e.g. ~/.ssh, ~/.gnupg, /etc, /var). The user has to opt
// in to a narrower directory by `cd`'ing before invoking pi. We
// fail closed (same posture as the rest of the extension) rather
// than warn-and-continue.
async function assertWorkspaceIsBounded(localCwd: string): Promise<void> {
	const home = process.env.HOME ? await realpath(process.env.HOME).catch(() => process.env.HOME) : undefined;
	const tmp = await realpath("/tmp").catch(() => "/tmp");
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
	if (resolvedCwd === tmp) {
		// setupDir and the per-call NEWTMP mount point both live under
		// /tmp (hardcoded in writeSetupScript). Binding /tmp as the
		// workspace would expose both to the LLM: it could tamper with
		// the setup script and pre-plant files in NEWTMP that survive
		// pivot_root into dirs not later rbind'd over (/opt, /home,
		// /var, /root, ...).
		throw new Error(
			`ns-sandbox: refusing to enable — workspace is /tmp (${tmp}). This sandbox's setup script and per-call mount point live under /tmp; binding /tmp as the workspace would expose them to the model. ` +
			`Run pi from a project subdirectory.`,
		);
	}
}

// Refuse to enable when the extension's own source file is inside
// the workspace. The bind-mount is the workspace; the LLM has full
// read/write to anything in it, including the extension's source.
// Once the LLM can edit sandbox.ts it can rewrite this check, the
// bind-mount source, or the test assertions, defeating the sandbox.
// Move the extension out of any project you intend to jail.
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
	// Length-captured (truncated to 200 chars + "…") output of the test command,
	// for inclusion in the table; full output for a failing test goes in `detail`.
	stdout: string;
	stderr: string;
}

// Spawn one test command through the same unshare+setup flow the
// agent's bash tool uses, capture stdout/stderr/exit, and assert
// against the test's expectation. Per-test timeout defaults to 10s.
async function runOneSandboxTest(
	setupDir: string,
	bindSource: string,
	noNetwork: boolean,
	test: SandboxTest,
): Promise<SandboxTestResult> {
	if (test.skipWhenAirgap && noNetwork) {
		return { name: test.name, pass: true, skipped: true, stdout: "", stderr: "" };
	}
	const capture = { stdout: "", stderr: "" };
	try {
		const { exitCode, timedOut } = await runSandboxCommand(setupDir, bindSource, noNetwork, {
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

// Run the full self-test suite. Used at the shipped version too: a user
// can pass `--sandbox-test` to pi to verify their Linux has everything
// the sandbox needs. Reports results to stdout and the pi UI, then
// exits the process with 0 on success or 1 on any failure.
async function runSandboxTestSuite(
	localCwd: string,
	setupPath: string,
	setupDir: string,
	noNetwork: boolean,
	ctx: { ui: { notify: (msg: string, kind: "info" | "error") => void } },
): Promise<void> {
	const header = `ns-sandbox: self-test on ${localCwd}${noNetwork ? " (--airgap)" : ""}`;
	process.stdout.write(`${header}\n`);
	const results: SandboxTestResult[] = [];
	for (const test of SANDBOX_TESTS) {
		// Mark "skipped" inline so the row is unambiguous.
		const result = await runOneSandboxTest(setupDir, localCwd, noNetwork, test);
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

// Shared spawn/kill/capture loop used by both the bash tool (`makeBashOps.exec`)
// and the self-test suite (`runOneSandboxTest`). Output is either streamed
// via `onChunk` (production path) or captured into the `capture` buffers
// (test path). The two are mutually exclusive in practice.
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
	setupDir: string,
	bindSource: string,
	noNetwork: boolean,
	opts: SandboxRunOptions,
): Promise<SandboxRunResult> {
	if (opts.signal?.aborted) {
		throw new Error("aborted");
	}
	if (!opts.bashCwd) {
		// Refuse to fall back to process.cwd(): the bind-mount source must
		// be the trusted localCwd captured at extension load, not whatever
		// directory the parent process happens to be in. The bash tool
		// always passes a cwd, so this is a fail-fast guard, not a UX path.
		throw new Error("ns-sandbox: bash tool called without a cwd");
	}
	// bindSource is the host path that gets bind-mounted into the namespace;
	// it is fixed at extension load (localCwd) and never taken from the model,
	// so the model cannot escape the sandbox by asking us to bind-mount a
	// different host path. The model's cwd becomes the bash command's
	// working directory inside the namespace (post-pivot_root), so the model
	// can navigate to any path it likes, but everything it can reach is
	// already inside the namespace.
	const flags = noNetwork ? [...UNSHARE_BASE_FLAGS, "--net"] : UNSHARE_BASE_FLAGS;
	// Defense in depth: rewrite the setup script on every call. Even
	// if a future bug ever lets the LLM reach setupDir (e.g. /tmp
	// refused-check is bypassed, or a symlink/HOME-relative path
	// resolves into setupDir), the script is atomically replaced
	// before exec, so any tamper is overwritten. The unlink-then-write
	// also defeats symlink/FIFO/hardlink substitution and perm
	// changes: Node's `writeFile({ mode })` only sets the mode at file
	// creation, not on overwrite, and a symlink at setupPath would
	// otherwise follow and write into the linked-to file.
	const setupPath = join(setupDir, SETUP_SCRIPT_NAME);
	await rm(setupPath, { force: true });
	await writeFile(setupPath, SETUP_SCRIPT, { mode: 0o700 });
	const runDir = await mkdtemp(join(setupDir, opts.capture ? "test-XXXXXX" : "run-XXXXXX"));
	// rm() after the process settles handles EBUSY (tmpfs still mounted) and
	// any stray files left behind by a failed setup; the session_shutdown
	// `rm -rf setupDir` is the outer safety net.
	try {
		return await new Promise<SandboxRunResult>((resolveRun, rejectRun) => {
			const child = spawn(
				"unshare",
				[
					...flags, "--",
					"/bin/bash", join(setupDir, SETUP_SCRIPT_NAME),
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
			// Output routing: capture buffers are written by stream
			// (stdout vs stderr) to keep them separable; otherwise the
			// caller's onChunk receives both interleaved.
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

function makeBashOps(localCwd: string, setupDir: string, noNetwork: boolean): BashOperations {
	return {
		exec(command, cwd, { onData, signal, timeout }) {
			return runSandboxCommand(setupDir, localCwd, noNetwork, {
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

function makeReadOps(workspace: string, setupDir: string): ReadOperations {
	return {
		readFile: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, setupDir, absolutePath);
			return readFile(safe);
		},
		access: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, setupDir, absolutePath);
			await access(safe, constants.R_OK);
		},
	};
}

function makeWriteOps(workspace: string, setupDir: string): WriteOperations {
	return {
		writeFile: async (absolutePath, content) => {
			const safe = await resolveInsideWorkspace(workspace, setupDir, absolutePath);
			// Ensure the parent directory exists. fs.writeFile doesn't
			// create intermediate dirs, and the model shouldn't have to
			// mkdir before writing to /tmp/whatever.
			await mkdir(dirname(safe), { recursive: true });
			await writeFile(safe, content, "utf-8");
		},
		mkdir: async (dir) => {
			const safe = await resolveInsideWorkspace(workspace, setupDir, dir);
			await mkdir(safe, { recursive: true });
		},
	};
}

function makeEditOps(workspace: string, setupDir: string): EditOperations {
	return { ...makeReadOps(workspace, setupDir), ...makeWriteOps(workspace, setupDir) };
}

function makeGrepOps(workspace: string, setupDir: string): GrepOperations {
	return {
		isDirectory: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, setupDir, absolutePath);
			return (await stat(safe)).isDirectory();
		},
		readFile: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, setupDir, absolutePath);
			return readFile(safe, "utf-8");
		},
	};
}

async function existsOp(workspace: string, setupDir: string, absolutePath: string): Promise<boolean> {
	try {
		const safe = await resolveInsideWorkspace(workspace, setupDir, absolutePath);
		await access(safe, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function makeFindOps(workspace: string, setupDir: string): FindOperations {
	return {
		exists: (p) => existsOp(workspace, setupDir, p),
		// Unused: the find tool's runtime checks `customOps?.glob` and falls
		// back to fd when it's not provided. We return [] to satisfy the type.
		glob: () => [],
	};
}

function makeLsOps(workspace: string, setupDir: string): LsOperations {
	return {
		exists: (p) => existsOp(workspace, setupDir, p),
		stat: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, setupDir, absolutePath);
			return stat(safe);
		},
		readdir: async (absolutePath) => {
			const safe = await resolveInsideWorkspace(workspace, setupDir, absolutePath);
			return readdir(safe);
		},
	};
}

// Self-test suite. Run when the user passes `--sandbox-test` to pi. Each
// test is a full-scope unshare+setup+command invocation — the same code
// path the real agent's bash tool uses — so a passing test is strong
// evidence the agent will also work on this host. Used at the shipped
// version too: a user can run `pi -e ./sandbox.ts --sandbox-test` to
// verify their Linux has everything the sandbox needs (unshare with
// --map-root-user, setpriv --no-new-privs, the inner unshare with
// --map-user/--map-group, /etc+resolv.conf reachable, /run/docker.sock
// and ~/.ssh correctly hidden, network/TLS, etc.).
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
	let activeTools: Set<string> | undefined;
	let noNetwork = false;
	let runSandboxTests = false;

	let setupPath: string | undefined;
	let setupDir: string | undefined;

	// Each entry: [tool name, base tool (built-in), factory(localCwd, setupDir, noNetwork) -> sandboxed tool].
	// Adding a new tool is one line; the loop below wires label, execute guard, and the active-set filter.
	const TOOL_OVERRIDES: ReadonlyArray<readonly [string, any, (cwd: string, dir: string, noNet: boolean) => any]> = [
		["bash", createBashTool(localCwd), (cwd, dir, noNet) => createBashTool(cwd, { operations: makeBashOps(cwd, dir, noNet) })],
		["read", createReadTool(localCwd), (cwd, dir) => createReadTool(cwd, { operations: makeReadOps(cwd, dir) })],
		["write", createWriteTool(localCwd), (cwd, dir) => createWriteTool(cwd, { operations: makeWriteOps(cwd, dir) })],
		["edit", createEditTool(localCwd), (cwd, dir) => createEditTool(cwd, { operations: makeEditOps(cwd, dir) })],
		["grep", createGrepTool(localCwd), (cwd, dir) => createGrepTool(cwd, { operations: makeGrepOps(cwd, dir) })],
		["find", createFindTool(localCwd), (cwd, dir) => createFindTool(cwd, { operations: makeFindOps(cwd, dir) })],
		["ls", createLsTool(localCwd), (cwd, dir) => createLsTool(cwd, { operations: makeLsOps(cwd, dir) })],
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
			// The extension runner catches errors from session_start and
			// continues the agent with built-in tools. We refuse to
			// participate in that fallback: force-exit the process so
			// the user cannot run an unsandboxed agent after opting in
			// to the sandbox. process.exit(1) terminates synchronously;
			// a follow-up throw would be unreachable dead code.
			process.exit(1);
		}
		try {
			await assertWorkspaceIsBounded(localCwd);
			await assertExtensionNotInWorkspace(localCwd, SELF_FILE);
			const setup = await writeSetupScript();
			setupPath = setup.path;
			setupDir = setup.dir;
			// Eagerly create the per-session persistent /tmp backing dir so
			// the file tools can write to /tmp before the first bash call.
			// (The bash setup script also creates it on first invocation.)
			await mkdir(join(setupDir, "tmp"), { recursive: true });
			noNetwork = Boolean(pi.getFlag("airgap"));
			runSandboxTests = Boolean(pi.getFlag("sandbox-test"));
			activeTools = new Set(pi.getActiveTools());

			for (const [name, base, build] of TOOL_OVERRIDES) {
				if (!activeTools.has(name)) continue;
				const sandboxed = build(localCwd, setupDir, noNetwork);
				pi.registerTool({
					...base,
					label: `${name} (sandboxed)`,
					async execute(...args: any[]) {
						if (!setupDir) throw new Error(`ns-sandbox: ${name} (sandboxed) called but sandbox is not initialised`);
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
				await runSandboxTestSuite(localCwd, setupPath!, setupDir!, noNetwork, ctx);
			}
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			const message = `ns-sandbox: cannot enable — ${reason}`;
			console.error(message);
			ctx.ui.notify(message, "error");
			// See the preflight-failed branch above: process.exit is what
			// actually exits; a follow-up throw would be unreachable.
			process.exit(1);
		}
	});

	pi.on("session_shutdown", async () => {
		setupPath = undefined;
		if (setupDir) {
			try {
				await rm(setupDir, { recursive: true, force: true });
			} catch {
				// tmp will clean it eventually; ignore.
			}
			setupDir = undefined;
		}
	});

	// `!` shell command hook. Only sandbox if bash is active, so that
	// disabling bash in the tool set also disables `!` sandboxing.
	// The active set is captured in session_start (after the runtime is
	// bound); until then this hook is a no-op.
	pi.on("user_bash", (_event, _ctx) => {
		if (!activeTools?.has("bash") || !setupDir) return undefined;
		return { operations: makeBashOps(localCwd, setupDir, noNetwork) };
	});

	// Update the working-directory hint in the system prompt.
	pi.on("before_agent_start", async (event) => {
		if (!setupDir) return undefined;
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
			const lines = setupDir
				? [
						"ns-sandbox: active",
						`Sandbox cwd: ${localCwd} (same as host cwd)`,
						`Setup script: ${setupPath ?? "(unknown)"}`,
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
	probeSetpriv,
	probeUnshare,
	resolveInsideWorkspace,
	runOneSandboxTest,
	runSandboxTestSuite,
	writeSetupScript,
};
export type { SandboxTest, SandboxTestResult };
