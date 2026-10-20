#!/usr/bin/env python3
"""Exercise generated completion through real Readline and ZLE Tab handling."""

import argparse
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import re
import select
import shlex
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time


PACKAGE = Path(__file__).resolve().parents[2]
ROOT = PACKAGE.parents[1]
MARKER = "__DAYNIGHT_CAPTURE__"
READY = "__DAYNIGHT_READY__"
ARGUMENT = "__DAYNIGHT_ARGUMENT__"
FINISHED = "__DAYNIGHT_FINISHED__"


class Terminal:
    def __init__(self, binary, kind, cwd, environment, setup):
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            try:
                os.chdir(cwd)
                arguments = [binary, "--noprofile", "--norc", "-i"] if kind == "bash" else [binary, "-f", "-i"]
                os.execve(binary, arguments, environment)
            except BaseException:
                os._exit(127)
        self.transcript = bytearray()
        self.pending = bytearray()
        self.calls = cwd / "daynight-invocations.log"
        self.forbidden = cwd / "forbidden-executions.log"
        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 240, 0, 0))
            self.send(setup + "\n")
            self.until(READY + "\r\n")
            self.drain()
        except BaseException:
            self.close()
            raise

    def send(self, text):
        os.write(self.fd, text.encode())

    def read(self, timeout):
        if not select.select([self.fd], [], [], timeout)[0]:
            return b""
        try:
            data = os.read(self.fd, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                raise AssertionError("The interactive shell exited unexpectedly") from error
            raise
        if not data:
            raise AssertionError("The interactive shell closed its terminal")
        self.transcript.extend(data)
        self.pending.extend(data)
        return data

    def until(self, marker, timeout=8):
        expected = marker.encode()
        deadline = time.monotonic() + timeout
        while expected not in self.pending:
            if time.monotonic() >= deadline:
                raise AssertionError(f"Timed out waiting for {marker!r}: {self.pending.decode(errors='replace')!r}")
            self.read(min(0.2, deadline - time.monotonic()))
        end = self.pending.index(expected) + len(expected)
        result = bytes(self.pending[:end]).decode(errors="replace")
        del self.pending[:end]
        return result

    def drain(self):
        while self.read(0.03):
            pass
        self.pending.clear()

    def complete(self, keys):
        calls_before = self.calls.read_bytes() if self.calls.exists() else b""
        self.send(keys + "\x18\x12")
        output = self.until(MARKER + "END\r\n")
        capture = re.search(MARKER + r"BEGIN(.*?)" + MARKER + r"CURSOR(\d+)" + MARKER + "END", output, re.S)
        if capture is None:
            raise AssertionError(f"Missing captured input: {output!r}")
        calls_after = self.calls.read_bytes() if self.calls.exists() else b""
        if ARGUMENT in output or "__DAYNIGHT_FORBIDDEN_NODE__" in output or calls_after != calls_before or self.forbidden.exists():
            raise AssertionError(f"Completion executed a CLI process: {output!r}")
        return capture.group(1), int(capture.group(2)), output

    def execute(self):
        self.send("\x05\n")
        output = self.until(FINISHED + "\r\n")
        arguments = re.findall(ARGUMENT + r"(.*?)" + ARGUMENT + "END", output)
        self.drain()
        return arguments

    def clear(self):
        self.send("\x03")
        self.drain()

    def close(self):
        try:
            os.killpg(self.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            child, _ = os.waitpid(self.pid, os.WNOHANG)
            if child:
                break
            time.sleep(0.02)
        else:
            os.killpg(self.pid, signal.SIGKILL)
            os.waitpid(self.pid, 0)
        os.close(self.fd)


def shell_setup(kind, script, zsh_root):
    common = "PS1='__DAYNIGHT_PROMPT__ '; PS2='__DAYNIGHT_CONTINUE__ '; "
    if kind == "bash":
        setup = common + "set +o history; bind 'set bell-style none'; bind 'set show-all-if-ambiguous on'; bind 'set completion-query-items 0'; "
        setup += "_daynight_capture() { printf '\\n" + MARKER + "BEGIN%s" + MARKER + "CURSOR%s" + MARKER + "END\\n' \"$READLINE_LINE\" \"$READLINE_POINT\"; }; "
        setup += "bind -x '\"\\C-x\\C-r\":_daynight_capture'; "
    else:
        setup = common + "unsetopt BEEP AUTO_MENU MENU_COMPLETE; "
        if zsh_root:
            root = shlex.quote(str(Path(zsh_root).resolve()))
            setup += "_dn_root=" + root + "; module_path=($_dn_root/usr/lib/*/zsh/*(/) $module_path); fpath=($_dn_root/usr/share/zsh/functions/*(/) $_dn_root/usr/share/zsh/functions/Completion/*(/) $fpath); "
        setup += "autoload -Uz compinit; compinit -D; bindkey -e; "
        setup += "_daynight_capture() { printf '\\n" + MARKER + "BEGIN%s" + MARKER + "CURSOR%s" + MARKER + "END\\n' \"$BUFFER\" \"$CURSOR\"; zle redisplay; }; zle -N _daynight_capture; bindkey '^X^R' _daynight_capture; "
    setup += "source " + shlex.quote(str(script)) + " || exit 90; "
    # Completion must not invoke these functions. Enter invokes only this harmless argv recorder.
    setup += "daynight() { printf x >>daynight-invocations.log; printf '\\n'; for _dn_arg in \"$@\"; do printf '" + ARGUMENT + "%s" + ARGUMENT + "END\\n' \"$_dn_arg\"; done; printf '" + FINISHED + "\\n'; }; "
    setup += "node() { printf x >>forbidden-executions.log; printf '__DAYNIGHT_FORBIDDEN_NODE__\\n'; return 99; }; printf '" + READY + "\\n'"
    return setup


def executable(variable, default):
    value = os.environ.get(variable, default)
    binary = shutil.which(value)
    if binary is None:
        raise AssertionError(f"Required shell not found: {variable}={value!r}; run packages/daynight/scripts/prepare-completion-shells.sh")
    return str(Path(binary).resolve())


def version(binary):
    return subprocess.run([binary, "--version"], check=True, capture_output=True, text=True, timeout=10).stdout.splitlines()[0]


def open_quote(line):
    quote = ""
    escaped = False
    for character in line:
        if escaped:
            escaped = False
        elif character == "\\" and quote != "'":
            escaped = True
        elif character == quote:
            quote = ""
        elif character in "\"'" and not quote:
            quote = character
    return quote


def scenarios():
    cases = [
        ("root command and local directory collision", "daynight rev\t", ["review"]),
        ("root update", "daynight upd\t", ["update"]),
        ("root completion", "daynight comp\t", ["completion"]),
        ("review run", "daynight review ru\t", ["review", "run"]),
        ("review list", "daynight review li\t", ["review", "list"]),
        ("quoted command name", "daynight 'review' li\t", ["review", "list"]),
        ("quoted nested command name", "daynight review 'add-repo' --pa\t", ["review", "add-repo", "--path"]),
        ("review alias", "daynight review ls\t", ["review", "ls"]),
        ("nested command", "daynight review ad\t", ["review", "add-repo"]),
        ("root help", "daynight --he\t", ["--help"]),
        ("root version", "daynight --ver\t", ["--version"]),
        ("nested help", "daynight review --he\t", ["review", "--help"]),
        ("leaf help", "daynight review run --he\t", ["review", "run", "--help"]),
        ("bash shell choice", "daynight completion ba\t", ["completion", "bash"]),
        ("zsh shell choice", "daynight completion zs\t", ["completion", "zsh"]),
        ("path before remote", "daynight review add-repo --pa\t", ["review", "add-repo", "--path"]),
        ("path after HTTPS remote", "daynight review add-repo https://github.com/acme/repo.git --pa\t", ["review", "add-repo", "https://github.com/acme/repo.git", "--path"]),
        ("path after SSH remote", "daynight review add-repo git@github.com:acme/repo.git --pa\t", ["review", "add-repo", "git@github.com:acme/repo.git", "--path"]),
        ("directory before remote", "daynight review add-repo --path nor\t", ["review", "add-repo", "--path", "normal-directory/"]),
        ("directory after remote", "daynight review add-repo acme/repo --path nor\t", ["review", "add-repo", "acme/repo", "--path", "normal-directory/"]),
        ("directory followed by remote", "daynight review add-repo --path nor\t acme/repo", ["review", "add-repo", "--path", "normal-directory/", "acme/repo"]),
        ("escaped space directory", "daynight review add-repo --path sp\t", ["review", "add-repo", "--path", "space directory/"]),
        ("single quoted directory", "daynight review add-repo --path 'sp\t", ["review", "add-repo", "--path", "space directory/"]),
        ("double quoted directory", 'daynight review add-repo --path "sp\t', ["review", "add-repo", "--path", "space directory/"]),
        ("Unicode directory", "daynight review add-repo --path 中\t", ["review", "add-repo", "--path", "中文目录/"]),
        ("apostrophe directory", "daynight review add-repo --path apo\t", ["review", "add-repo", "--path", "apostrophe'directory/"]),
        ("double quote directory", "daynight review add-repo --path dou\t", ["review", "add-repo", "--path", 'double"directory/']),
        ("dollar directory", 'daynight review add-repo --path "dol\t', ["review", "add-repo", "--path", "dollar$directory/"]),
        ("backtick directory", 'daynight review add-repo --path "bac\t', ["review", "add-repo", "--path", "backtick`directory/"]),
        ("colon directory", "daynight review add-repo --path col\t", ["review", "add-repo", "--path", "colon:directory/"]),
        ("colon directory after word break", "daynight review add-repo --path colon:di\t", ["review", "add-repo", "--path", "colon:directory/"]),
        ("literal quoted tilde", "daynight review add-repo --path '~lit\t", ["review", "add-repo", "--path", "~literal/"]),
        ("literal escaped tilde", "daynight review add-repo --path \\~lit\t", ["review", "add-repo", "--path", "~literal/"]),
        ("cursor before following arguments", "daynight review ad --path normal-directory/\x01" + "\x06" * len("daynight review ad") + "\t", ["review", "add-repo", "--path", "normal-directory/"]),
        ("Unicode cursor before following option", "daynight review add-repo --path 中 --bad\x01" + "\x06" * len("daynight review add-repo --path 中") + "\t", ["review", "add-repo", "--path", "中文目录/", "--bad"]),
    ]
    unchanged = [
        ("remote has no file fallback", "daynight review add-repo nor"),
        ("used path is hidden", "daynight review add-repo acme/repo --path normal-directory/ --pa"),
        ("consumed shell choice is hidden", "daynight completion bash zs"),
        ("nonexistent directory leaf", "daynight review add-repo --path missing-leaf"),
        ("unknown option stops completion", "daynight review add-repo --bad --pa"),
        ("terminal help stops completion", "daynight review --help ru"),
        ("version does not inherit", "daynight review --ver"),
    ]
    return cases, unchanged


def run_shell(label, binary, kind, script, directory, evidence, zsh_root):
    environment = dict(os.environ)
    environment.update({"HOME": str(directory / "home"), "ZDOTDIR": str(directory / "home"), "INPUTRC": "/dev/null", "TERM": "xterm", "LC_ALL": "C.UTF-8", "HISTFILE": "/dev/null", "PATH": str(directory / "bin") + os.pathsep + os.environ["PATH"]})
    shell = Terminal(binary, kind, directory, environment, shell_setup(kind, script, zsh_root))
    receipt = {"shell": label, "binary": binary, "version": version(binary), "scenarios": []}
    evidence.append(receipt)
    try:
        cases, unchanged = scenarios()
        cases.append(("home directory", "daynight review add-repo --path ~/hom\t", ["review", "add-repo", "--path", str(directory / "home" / "home-directory") + "/"]))
        for name, keys, expected in cases:
            line, cursor, output = shell.complete(keys)
            if open_quote(line):
                shell.send(open_quote(line))
            actual = shell.execute()
            native_expected = list(expected)
            # ZLE removes an automatically added directory slash when accepting the line.
            if kind == "zsh" and "--path" in expected:
                path_index = expected.index("--path") + 1
                if path_index < len(expected) and path_index < len(actual) and expected[path_index].endswith("/") and actual[path_index] == expected[path_index][:-1]:
                    native_expected[path_index] = expected[path_index][:-1]
            result = {"name": name, "line": line, "cursor": cursor, "argv": actual, "passed": actual == native_expected}
            receipt["scenarios"].append(result)
            if actual != native_expected:
                raise AssertionError(f"{label}: {name}: expected {native_expected!r}, received {actual!r}, line={line!r}, terminal={output!r}")
            if name == "root command and local directory collision" and line != "daynight review ":
                raise AssertionError(f"{label}: command completion must append a space despite the local review directory: {line!r}")
            print(f"PASS {label}: {name}", flush=True)
        for name, line in unchanged:
            actual, cursor, output = shell.complete(line + "\t")
            result = {"name": name, "line": actual, "cursor": cursor, "passed": actual == line}
            receipt["scenarios"].append(result)
            shell.clear()
            if actual != line:
                raise AssertionError(f"{label}: {name}: expected unchanged {line!r}, received {actual!r}, terminal={output!r}")
            print(f"PASS {label}: {name}", flush=True)
        for name, line, candidates in [
            ("empty root prefix", "daynight ", ["review", "update", "completion"]),
            ("empty review prefix", "daynight review ", ["run", "list", "ls", "add-repo"]),
            ("empty shell prefix", "daynight completion ", ["bash", "zsh"]),
        ]:
            actual, cursor, output = shell.complete(line + "\t\t")
            missing = [candidate for candidate in candidates if candidate not in output]
            receipt["scenarios"].append({"name": name, "line": actual, "cursor": cursor, "passed": not missing})
            shell.clear()
            if missing:
                raise AssertionError(f"{label}: {name}: missing candidates {missing!r}: {output!r}")
            print(f"PASS {label}: {name}", flush=True)
    finally:
        receipt["transcript"] = bytes(shell.transcript).decode(errors="replace")
        shell.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--shell", choices=["all", "bash42", "bash", "zsh"], default="all")
    arguments = parser.parse_args()
    temporary = ROOT / ".tmp"
    temporary.mkdir(exist_ok=True)
    receipt_path = Path(os.environ.get("DAYNIGHT_COMPLETION_EVIDENCE", str(temporary / "completion-evidence.json"))).resolve()
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    evidence = {"shells": [], "passed": False}
    try:
        with tempfile.TemporaryDirectory(prefix="completion-acceptance-", dir=temporary) as path:
            directory = Path(path)
            (directory / "bin").mkdir()
            for command in ["node", "daynight"]:
                sentinel = directory / "bin" / command
                sentinel.write_text("#!/bin/sh\nprintf x >>" + shlex.quote(str(directory / "forbidden-executions.log")) + "\nprintf '__DAYNIGHT_FORBIDDEN_NODE__\\n'\nexit 99\n")
                sentinel.chmod(0o755)
            for name in ["review", "normal-directory", "space directory", "中文目录", "apostrophe'directory", 'double"directory', "dollar$directory", "backtick`directory", "colon:directory", "~literal", "home/home-directory"]:
                (directory / name).mkdir(parents=True)
            scripts = {}
            for kind in ["bash", "zsh"]:
                result = subprocess.run([executable("DAYNIGHT_TEST_NODE", "node"), str(PACKAGE / "dist/main.js"), "completion", kind], check=True, capture_output=True, text=True, timeout=15, cwd=PACKAGE)
                scripts[kind] = directory / ("completion." + kind)
                scripts[kind].write_text(result.stdout)
            selected = []
            if arguments.shell in ["all", "bash42"]:
                binary = executable("DAYNIGHT_TEST_BASH42", "bash4.2")
                if not re.search(r"version 4\.2(?:\.|\()", version(binary)):
                    raise AssertionError("DAYNIGHT_TEST_BASH42 must identify a real Bash 4.2 binary")
                selected.append(("Bash 4.2", binary, "bash"))
            if arguments.shell in ["all", "bash"]:
                binary = executable("DAYNIGHT_TEST_BASH", "bash")
                if not re.search(r"version [5-9]\.", version(binary)):
                    raise AssertionError("DAYNIGHT_TEST_BASH must identify a modern Bash >=5")
                selected.append(("modern Bash", binary, "bash"))
            if arguments.shell in ["all", "zsh"]:
                selected.append(("zsh", executable("DAYNIGHT_TEST_ZSH", "zsh"), "zsh"))
            for label, binary, kind in selected:
                subprocess.run([binary, "-n", str(scripts[kind])], check=True, timeout=10)
                run_shell(label, binary, kind, scripts[kind], directory, evidence["shells"], os.environ.get("DAYNIGHT_TEST_ZSH_ROOT"))
            if arguments.shell in ["all", "zsh"]:
                binary = executable("DAYNIGHT_TEST_ZSH", "zsh")
                source = "typeset -A _comps; source " + shlex.quote(str(scripts["zsh"])) + "; _dn_status=$?; print -r -- __REGISTERED__${_comps[daynight]-}; exit $_dn_status"
                if os.environ.get("DAYNIGHT_TEST_ZSH_ROOT"):
                    root = shlex.quote(str(Path(os.environ["DAYNIGHT_TEST_ZSH_ROOT"]).resolve()))
                    source = "_dn_root=" + root + "; module_path=($_dn_root/usr/lib/*/zsh/*(/) $module_path); " + source
                result = subprocess.run([binary, "-f", "-c", source], capture_output=True, text=True, timeout=10)
                if result.returncode == 0 or "compinit" not in result.stderr or result.stdout.strip() != "__REGISTERED__":
                    raise AssertionError(f"zsh without compinit must fail with a clear diagnostic: {result!r}")
                evidence["zsh_without_compinit"] = {"exitCode": result.returncode, "stderr": result.stderr, "passed": True}
                print("PASS zsh: loading without compinit fails clearly", flush=True)
            evidence["passed"] = True
    finally:
        receipt_path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
        print(f"Completion evidence: {receipt_path.relative_to(ROOT) if receipt_path.is_relative_to(ROOT) else receipt_path}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
