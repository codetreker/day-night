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
PROMPT = "__DAYNIGHT_PROMPT_GENERATION__"
EDITOR_KEY = "\x1b!"
RESET_KEY = "\x1b?"
ARGUMENT = "__DAYNIGHT_ARGUMENT__"
FINISHED = "__DAYNIGHT_FINISHED__"


class Terminal:
    def __init__(self, binary, kind, cwd, environment, setup):
        gate_reader, self.gate_writer = os.pipe()
        capture_reader, self.capture_gate_writer = os.pipe()
        os.set_inheritable(gate_reader, True)
        os.set_inheritable(capture_reader, True)
        environment = dict(environment, DAYNIGHT_EDITOR_GATE_FD=str(gate_reader), DAYNIGHT_CAPTURE_GATE_FD=str(capture_reader))
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            try:
                os.close(self.gate_writer)
                os.close(self.capture_gate_writer)
                os.chdir(cwd)
                arguments = [binary, "--noprofile", "--norc", "-i"] if kind == "bash" else [binary, "-d", "-i"]
                os.execve(binary, arguments, environment)
            except BaseException:
                os._exit(127)
        os.close(gate_reader)
        os.close(capture_reader)
        self.transcript = bytearray()
        self.pending = bytearray()
        self.generation = 0
        self.editor_ready = False
        self.readiness_proof = False
        self.capture_reset_proof = False
        self.calls = cwd / "daynight-invocations.log"
        self.forbidden = cwd / "forbidden-executions.log"
        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 240, 0, 0))
            self.send(setup + "\n")
            self.await_editor(prove_transition=True)
            self.prove_capture_reset()
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

    def acknowledge_editor(self, probe_sent=False):
        if not probe_sent:
            self.send(EDITOR_KEY)
        output = self.until(READY + "END\r\n")
        match = re.search(READY + r"GEN(\d+)" + READY + r"BUFFER(.*?)" + READY + r"CURSOR(\d+)" + READY + "END", output, re.S)
        if match is None or int(match.group(1)) != self.generation or match.group(2) != "" or int(match.group(3)) != 0:
            raise AssertionError(f"The active editor is not empty and ready for generation {self.generation}: {output!r}")
        self.editor_ready = True

    def await_editor(self, prove_transition=False):
        output = self.until(PROMPT + "END\r\n")
        match = re.search(PROMPT + r"(\d+)" + PROMPT + "END", output)
        if match is None or int(match.group(1)) != self.generation + 1:
            raise AssertionError(f"Expected the next primary prompt after generation {self.generation}: {output!r}")
        self.generation = int(match.group(1))
        self.editor_ready = False
        self.send(EDITOR_KEY)
        if prove_transition:
            # The prompt hook is blocked before editor entry. Quiet output cannot establish readiness.
            self.assert_no_editor_ack()
            os.write(self.gate_writer, b"release\n")
            os.close(self.gate_writer)
            self.gate_writer = None
            self.readiness_proof = True
        self.acknowledge_editor(probe_sent=True)

    def assert_no_editor_ack(self):
        proof_deadline = time.monotonic() + 8
        while self.read(0.03):
            if time.monotonic() >= proof_deadline:
                raise AssertionError("The blocked editor transition did not become quiet")
        if (READY + "END").encode() in self.pending:
            raise AssertionError("The editor acknowledged input before its transition gate was released")

    def prove_capture_reset(self):
        proof_line = "editor reset proof"
        generation = self.generation
        line, cursor, output = self.complete(proof_line)
        if line != proof_line or cursor != len(proof_line):
            raise AssertionError(f"The capture-reset proof did not preserve its input: {output!r}")
        self.send(RESET_KEY)
        # The capture marker is already visible while its widget still holds the editor.
        self.assert_no_editor_ack()
        os.write(self.capture_gate_writer, b"release\n")
        os.close(self.capture_gate_writer)
        self.capture_gate_writer = None
        self.acknowledge_editor(probe_sent=True)
        if self.generation != generation:
            raise AssertionError("Resetting an editor must not start a new prompt generation")
        self.capture_reset_proof = True

    def complete(self, keys):
        if not self.editor_ready:
            raise AssertionError("A completion scenario requires a fresh empty editor")
        self.acknowledge_editor()
        self.editor_ready = False
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
        self.await_editor()
        return arguments

    def clear(self):
        self.send(RESET_KEY)
        self.acknowledge_editor(probe_sent=True)

    def close(self):
        for name in ["gate_writer", "capture_gate_writer"]:
            descriptor = getattr(self, name)
            if descriptor is not None:
                os.close(descriptor)
                setattr(self, name, None)
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


def shell_setup(kind, script):
    common = "PS1='__DAYNIGHT_PROMPT__ '; PS2='__DAYNIGHT_CONTINUE__ '; _daynight_generation=0; _daynight_capture_gate_pending=1; "
    common += "_daynight_prompt() { ((_daynight_generation+=1)); printf '\\n" + PROMPT + "%s" + PROMPT + "END\\n' \"$_daynight_generation\"; if (( _daynight_generation == 1 )); then read -r -u \"$DAYNIGHT_EDITOR_GATE_FD\" _daynight_release; fi; }; "
    common += "_daynight_hold_capture() { if (( _daynight_capture_gate_pending )); then _daynight_capture_gate_pending=0; read -r -u \"$DAYNIGHT_CAPTURE_GATE_FD\" _daynight_release; fi; }; "
    if kind == "bash":
        setup = common + "set +o history; bind 'set bell-style none'; bind 'set show-all-if-ambiguous on'; bind 'set completion-query-items 0'; "
        setup += "_daynight_capture() { printf '\\n" + MARKER + "BEGIN%s" + MARKER + "CURSOR%s" + MARKER + "END\\n' \"$READLINE_LINE\" \"$READLINE_POINT\"; _daynight_hold_capture; }; "
        setup += "bind -x '\"\\C-x\\C-r\":_daynight_capture'; "
        setup += "_daynight_editor_ready() { printf '\\n" + READY + "GEN%s" + READY + "BUFFER%s" + READY + "CURSOR%s" + READY + "END\\n' \"$_daynight_generation\" \"$READLINE_LINE\" \"$READLINE_POINT\"; }; bind -x '\"\\e!\":_daynight_editor_ready'; "
        setup += "_daynight_editor_reset() { READLINE_LINE=''; READLINE_POINT=0; _daynight_editor_ready; }; bind -x '\"\\e?\":_daynight_editor_reset'; "
    else:
        setup = common + "unsetopt BEEP AUTO_MENU MENU_COMPLETE; "
        setup += "autoload -Uz compaudit; compaudit || exit 91; autoload -Uz compinit; compinit -D; bindkey -e; "
        setup += "_daynight_capture() { printf '\\n" + MARKER + "BEGIN%s" + MARKER + "CURSOR%s" + MARKER + "END\\n' \"$BUFFER\" \"$CURSOR\"; _daynight_hold_capture; zle redisplay; }; zle -N _daynight_capture; bindkey '^X^R' _daynight_capture; "
        setup += "_daynight_editor_ready() { printf '\\n" + READY + "GEN%s" + READY + "BUFFER%s" + READY + "CURSOR%s" + READY + "END\\n' \"$_daynight_generation\" \"$BUFFER\" \"$CURSOR\"; zle redisplay; }; zle -N _daynight_editor_ready; bindkey '^[!' _daynight_editor_ready; "
        setup += "_daynight_editor_reset() { BUFFER=''; CURSOR=0; _daynight_editor_ready; }; zle -N _daynight_editor_reset; bindkey '^[?' _daynight_editor_reset; "
    setup += "source " + shlex.quote(str(script)) + " || exit 90; "
    # Completion must not invoke these functions. Enter invokes only this harmless argv recorder.
    setup += "daynight() { printf x >>daynight-invocations.log; printf '\\n'; for _dn_arg in \"$@\"; do printf '" + ARGUMENT + "%s" + ARGUMENT + "END\\n' \"$_dn_arg\"; done; printf '" + FINISHED + "\\n'; }; "
    setup += "node() { printf x >>forbidden-executions.log; printf '__DAYNIGHT_FORBIDDEN_NODE__\\n'; return 99; }; "
    setup += "PROMPT_COMMAND=_daynight_prompt" if kind == "bash" else "precmd_functions+=(_daynight_prompt)"
    return setup


def zsh_environment(directory, root):
    environment = dict(os.environ)
    environment.update({"HOME": str(directory / "home"), "ZDOTDIR": str(directory / "home")})
    environment.pop("FPATH", None)
    startup = "unsetopt GLOBAL_RCS\n"
    if root:
        root = Path(root).resolve()
        modules = sorted(path for path in root.glob("usr/lib/*/zsh/*") if path.is_dir())
        functions = root / "usr/share/zsh/functions"
        paths = sorted(path for pattern in ["*", "Completion/*"] for path in functions.glob(pattern) if path.is_dir())
        if not modules or not paths:
            raise AssertionError(f"Extracted zsh toolchain is incomplete: {root}")
        startup += "module_path=(" + " ".join(shlex.quote(str(path)) for path in modules) + ")\n"
        startup += "fpath=(" + " ".join(shlex.quote(str(path)) for path in paths) + ")\n"
    # MODULE_PATH from the environment is ignored; .zshenv precedes the first ZLE initialization.
    # https://zsh.sourceforge.io/Doc/Release/Parameters.html#index-module_005fpath
    # https://zsh.sourceforge.io/Doc/Release/Files.html#Startup_002fShutdown-Files
    startup += "unsetopt RCS\n"
    startup_path = directory / "home/.zshenv"
    startup_path.write_text(startup)
    startup_path.chmod(0o600)
    return environment


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
        ("root setup and local directory collision", "daynight set\t", ["setup"]),
        ("setup server URL option", "daynight setup --ser\t", ["setup", "--server-url"]),
        ("setup review repository option", "daynight setup --review-r\t", ["setup", "--review-repo"]),
        ("setup review path option", "daynight setup --review-p\t", ["setup", "--review-path"]),
        ("setup review directory", "daynight setup --review-path nor\t", ["setup", "--review-path", "normal-directory/"]),
        ("setup review after server URL", "daynight setup --server-url https://service.example --review-r\t", ["setup", "--server-url", "https://service.example", "--review-repo"]),
        ("root project and local directory collision", "daynight pro\t", ["project"]),
        ("project create", "daynight project cre\t", ["project", "create"]),
        ("project list", "daynight project li\t", ["project", "list"]),
        ("project show", "daynight project sh\t", ["project", "show"]),
        ("project help", "daynight project --he\t", ["project", "--help"]),
        ("project name option", "daynight project create --na\t", ["project", "create", "--name"]),
        ("project repo option", "daynight project create --re\t", ["project", "create", "--repo"]),
        ("project repo after text name", 'daynight project create --name "Day Night" --re\t', ["project", "create", "--name", "Day Night", "--repo"]),
        ("project name after repo", "daynight project create --repo git@github.com:acme/repo.git --na\t", ["project", "create", "--repo", "git@github.com:acme/repo.git", "--name"]),
        ("project list JSON", "daynight project list --js\t", ["project", "list", "--json"]),
        ("project show JSON", "daynight project show project-id --js\t", ["project", "show", "project-id", "--json"]),
        ("root task and local directory collision", "daynight ta\t", ["task"]),
        ("task create", "daynight task cre\t", ["task", "create"]),
        ("task list", "daynight task li\t", ["task", "list"]),
        ("task show", "daynight task sh\t", ["task", "show"]),
        ("task update", "daynight task upd\t", ["task", "update"]),
        ("task graph", "daynight task gr\t", ["task", "graph"]),
        ("task title option", "daynight task create --ti\t", ["task", "create", "--title"]),
        ("task list ready", "daynight task list --rea\t", ["task", "list", "--ready"]),
        ("task list separate status", "daynight task list --status in\t", ["task", "list", "--status", "in_progress"]),
        ("task list inline status", "daynight task list --status=do\t", ["task", "list", "--status=done"]),
        ("task update inline status", "daynight task update task-id --status=in\t", ["task", "update", "task-id", "--status=in_progress"]),
        ("task inline status before further options", "daynight task list --status=done --rea\t", ["task", "list", "--status=done", "--ready"]),
        ("task empty separate description", 'daynight task create --title Title --description "" --pro\t', ["task", "create", "--title", "Title", "--description", "", "--project"]),
        ("task empty inline description", "daynight task create --title Title --description='' --pro\t", ["task", "create", "--title", "Title", "--description=", "--project"]),
        ("task dash inline description", "daynight task create --title Title --description=-leading --pro\t", ["task", "create", "--title", "Title", "--description=-leading", "--project"]),
        ("task equals inline description", "daynight task create --title Title --description==a=b --pro\t", ["task", "create", "--title", "Title", "--description==a=b", "--project"]),
        ("task repeatable dependency remains available", "daynight task create --title Title --depends-on a --dep\t", ["task", "create", "--title", "Title", "--depends-on", "a", "--depends-on"]),
        ("task inline dependency followed by option", "daynight task create --title Title --depends-on=a --pro\t", ["task", "create", "--title", "Title", "--depends-on=a", "--project"]),
        ("task repeated inline and separate dependencies", "daynight task create --title Title --depends-on=a --depends-on a --dep\t", ["task", "create", "--title", "Title", "--depends-on=a", "--depends-on", "a", "--depends-on"]),
        ("task clear dependency flag", "daynight task update task-id --clear-dep\t", ["task", "update", "task-id", "--clear-dependencies"]),
        ("task version option", "daynight task update task-id --if-ver\t", ["task", "update", "task-id", "--if-version"]),
        ("task graph JSON", "daynight task graph --js\t", ["task", "graph", "--json"]),
        ("task inline project followed by JSON", "daynight task show task-id --project=project-id --js\t", ["task", "show", "task-id", "--project=project-id", "--json"]),
        ("project inline dash name", "daynight project create --name=-leading --re\t", ["project", "create", "--name=-leading", "--repo"]),
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
        ("setup server URL has no file fallback", "daynight setup --server-url nor"),
        ("setup review repository has no file fallback", "daynight setup --review-repo nor"),
        ("used setup server URL is hidden", "daynight setup --server-url https://service.example --ser"),
        ("remote has no file fallback", "daynight review add-repo nor"),
        ("project name has no file fallback", "daynight project create --name nor"),
        ("project repo has no file fallback", "daynight project create --repo nor"),
        ("project name has no option fallback", "daynight project create --name --re"),
        ("project repo has no option fallback", "daynight project create --repo --na"),
        ("quoted project text has no file fallback", 'daynight project create --name "nor'),
        ("project ID has no file fallback", "daynight project show nor"),
        ("used project name is hidden", 'daynight project create --name "Day Night" --na'),
        ("used project repo is hidden", "daynight project create --repo git@github.com:acme/repo.git --re"),
        ("used project JSON is hidden", "daynight project list --json --js"),
        ("task title has no file fallback", "daynight task create --title nor"),
        ("task description has no file fallback", "daynight task create --description nor"),
        ("task inline title has no file fallback", "daynight task create --title=nor"),
        ("task inline description has no option fallback", "daynight task create --description=--pro"),
        ("task empty inline description has no file fallback", "daynight task create --description="),
        ("task dependency has no file fallback", "daynight task create --depends-on nor"),
        ("task project has no file fallback", "daynight task list --project nor"),
        ("task ID has no file fallback", "daynight task show nor"),
        ("task version has no file fallback", "daynight task update task-id --if-version nor"),
        ("used task inline scalar status is hidden", "daynight task list --status=done --sta"),
        ("invalid inline task status stops completion", "daynight task list --status=invalid --rea"),
        ("invalid separate task status stops completion", "daynight task list --status invalid --rea"),
        ("empty dependency stops completion", "daynight task create --depends-on= --dep"),
        ("inline switch has no candidate fallback", "daynight task list --ready=true --sta"),
        ("inline directory remains unsupported", "daynight review add-repo acme/repo --path=nor"),
        ("used path is hidden", "daynight review add-repo acme/repo --path normal-directory/ --pa"),
        ("consumed shell choice is hidden", "daynight completion bash zs"),
        ("nonexistent directory leaf", "daynight review add-repo --path missing-leaf"),
        ("unknown option stops completion", "daynight review add-repo --bad --pa"),
        ("terminal help stops completion", "daynight review --help ru"),
        ("version does not inherit", "daynight review --ver"),
    ]
    return cases, unchanged


def run_shell(label, binary, kind, script, directory, evidence, zsh_root):
    environment = zsh_environment(directory, zsh_root) if kind == "zsh" else dict(os.environ)
    environment.pop("FPATH", None)
    environment.update({"HOME": str(directory / "home"), "ZDOTDIR": str(directory / "home"), "INPUTRC": "/dev/null", "TERM": "xterm", "LC_ALL": "C.UTF-8", "HISTFILE": "/dev/null", "PATH": str(directory / "bin") + os.pathsep + os.environ["PATH"]})
    shell = Terminal(binary, kind, directory, environment, shell_setup(kind, script))
    receipt = {"shell": label, "binary": binary, "version": version(binary), "editor_readiness_proof": shell.readiness_proof, "capture_reset_proof": shell.capture_reset_proof, "scenarios": []}
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
            directory_option = next((option for option in ["--path", "--review-path"] if option in expected), None)
            if kind == "zsh" and directory_option is not None:
                path_index = expected.index(directory_option) + 1
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
            ("empty root prefix", "daynight ", ["review", "update", "completion", "project", "task", "setup"]),
            ("empty setup prefix", "daynight setup ", ["--server-url", "--review-repo", "--review-path"]),
            ("empty review prefix", "daynight review ", ["run", "list", "ls", "add-repo"]),
            ("empty project prefix", "daynight project ", ["create", "list", "show"]),
            ("empty project create prefix", "daynight project create ", ["--name", "--repo"]),
            ("empty task prefix", "daynight task ", ["create", "list", "show", "update", "graph"]),
            ("empty separate task status", "daynight task list --status ", ["todo", "in_progress", "done"]),
            ("empty inline task status", "daynight task list --status=", ["todo", "in_progress", "done"]),
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
            for name in ["review", "project", "task", "setup", "normal-directory", "space directory", "中文目录", "apostrophe'directory", 'double"directory', "dollar$directory", "backtick`directory", "colon:directory", "~literal", "home/home-directory"]:
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
                environment = zsh_environment(directory, os.environ.get("DAYNIGHT_TEST_ZSH_ROOT"))
                result = subprocess.run([binary, "-d", "-c", source], env=environment, capture_output=True, text=True, timeout=10)
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
