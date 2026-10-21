package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/api"
)

type acceptanceCLIReceipt struct {
	SchemaVersion  int    `json:"schemaVersion"`
	Root           string `json:"root"`
	PackageVersion string `json:"packageVersion"`
	TarballPath    string `json:"tarballPath"`
	TarballSHA256  string `json:"tarballSha256"`
	NodePath       string `json:"nodePath"`
	EntryPath      string `json:"entryPath"`
	EntrySHA256    string `json:"entrySha256"`
	LauncherPath   string `json:"launcherPath"`
	Source         struct {
		GitSHA string `json:"gitSha"`
		Dirty  bool   `json:"dirty"`
	} `json:"source"`
}

type acceptanceCLIRequest struct {
	RequestID string `json:"requestId"`
	Status    int    `json:"status"`
}

func readAcceptanceCLI(t *testing.T) acceptanceCLIReceipt {
	t.Helper()
	receiptPath := os.Getenv("DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT")
	if receiptPath == "" {
		t.Fatal("DAYNIGHT_TEST_INSTALLED_CLI_RECEIPT is required for installed CLI acceptance; run scripts/check.sh")
	}
	data, err := os.ReadFile(receiptPath)
	if err != nil {
		t.Fatal("cannot read installed CLI receipt")
	}
	var receipt acceptanceCLIReceipt
	if err := json.Unmarshal(data, &receipt); err != nil || receipt.SchemaVersion != 1 || receipt.PackageVersion == "" || receipt.Source.GitSHA != binaryAcceptance.GitSHA || receipt.Source.Dirty != binaryAcceptance.Dirty {
		t.Fatal("installed CLI receipt does not match this source revision")
	}
	root, err := filepath.EvalSymlinks(receipt.Root)
	if err != nil || !filepath.IsAbs(root) {
		t.Fatal("installed CLI receipt has no absolute owned root")
	}
	projectTemporary, err := filepath.Abs(filepath.Join("..", "..", "..", "..", ".tmp"))
	if err != nil || !acceptanceCLIWithin(projectTemporary, root) {
		t.Fatal("installed CLI fixture is outside the project temporary directory")
	}
	for _, name := range []string{receipt.TarballPath, receipt.EntryPath, receipt.LauncherPath} {
		actual, err := filepath.EvalSymlinks(name)
		if err != nil || !filepath.IsAbs(name) || !acceptanceCLIWithin(root, actual) {
			t.Fatal("installed CLI artifact is outside its owned root")
		}
		info, err := os.Stat(actual)
		if err != nil || !info.Mode().IsRegular() {
			t.Fatal("installed CLI artifact is not a regular file")
		}
	}
	for _, artifact := range []struct{ path, digest string }{{receipt.TarballPath, receipt.TarballSHA256}, {receipt.EntryPath, receipt.EntrySHA256}} {
		content, err := os.ReadFile(artifact.path)
		if err != nil || fmt.Sprintf("%x", sha256.Sum256(content)) != artifact.digest {
			t.Fatal("installed CLI artifact hash differs from its receipt")
		}
	}
	if !filepath.IsAbs(receipt.NodePath) {
		t.Fatal("installed CLI receipt has no absolute Node executable")
	}
	info, err := os.Stat(receipt.NodePath)
	if err != nil || !info.Mode().IsRegular() {
		t.Fatal("installed CLI Node executable is unavailable")
	}
	manifestPath := filepath.Join(filepath.Dir(filepath.Dir(receipt.EntryPath)), "package.json")
	manifestData, err := os.ReadFile(manifestPath)
	if err != nil {
		t.Fatal("cannot read installed CLI package manifest")
	}
	var manifest struct {
		Name    string            `json:"name"`
		Version string            `json:"version"`
		Bin     map[string]string `json:"bin"`
	}
	if err := json.Unmarshal(manifestData, &manifest); err != nil || manifest.Name != "@codetreker/daynight" || manifest.Version != receipt.PackageVersion || manifest.Bin["daynight"] != "dist/main.js" {
		t.Fatal("installed CLI manifest differs from its receipt or public entry")
	}
	if filepath.Clean(filepath.Join(filepath.Dir(manifestPath), manifest.Bin["daynight"])) != filepath.Clean(receipt.EntryPath) {
		t.Fatal("installed CLI receipt does not identify its public manifest entry")
	}
	sourceData, err := os.ReadFile(filepath.Join(filepath.Dir(projectTemporary), "packages", "daynight", "package.json"))
	var sourceManifest struct {
		Version string `json:"version"`
	}
	if err != nil || json.Unmarshal(sourceData, &sourceManifest) != nil || sourceManifest.Version != receipt.PackageVersion {
		t.Fatal("installed CLI version differs from the source package")
	}
	if err := binaryAcceptance.update(func() { binaryAcceptance.InstalledCLI = &receipt }); err != nil {
		t.Fatal("cannot persist installed CLI identity")
	}
	return receipt
}

func acceptanceCLIWithin(root, name string) bool {
	relative, err := filepath.Rel(root, name)
	return err == nil && relative != "." && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

type acceptanceCLI struct {
	receipt  acceptanceCLIReceipt
	root     string
	home     string
	repo     string
	caller   string
	scenario *acceptanceScenario
}

func newAcceptanceCLI(t *testing.T, receipt acceptanceCLIReceipt, scenario *acceptanceScenario) *acceptanceCLI {
	t.Helper()
	root, err := os.MkdirTemp(filepath.Dir(binaryAcceptance.path), "installed CLI 中文 ")
	if err != nil {
		t.Fatal("cannot create owned installed CLI workspace")
	}
	fixture := &acceptanceCLI{receipt: receipt, root: root, home: filepath.Join(root, "home 中文"), repo: filepath.Join(root, "repository 中文"), caller: filepath.Join(root, "outside Git 中文"), scenario: scenario}
	t.Cleanup(func() {
		if err := os.RemoveAll(root); err != nil {
			t.Error("cannot remove owned installed CLI workspace")
		} else if err := binaryAcceptance.update(func() { scenario.CLIWorkspaceRemoved = true }); err != nil {
			t.Error("cannot persist installed CLI workspace cleanup")
		}
	})
	for _, directory := range []string{filepath.Join(fixture.home, ".daynight"), filepath.Join(fixture.repo, "source"), fixture.caller} {
		if err := os.MkdirAll(directory, 0o755); err != nil {
			t.Fatal("cannot create installed CLI fixture directories")
		}
	}
	fixture.git(t, "init", "--quiet", fixture.repo)
	fixture.git(t, "-C", fixture.repo, "remote", "add", "origin", "git@git.example:Org/Repo.git")
	return fixture
}

func (c *acceptanceCLI) environment() []string {
	values := map[string]string{
		"HOME": c.home, "USERPROFILE": c.home, "XDG_CONFIG_HOME": filepath.Join(c.home, "config"),
		"XDG_CACHE_HOME": filepath.Join(c.home, "cache"), "APPDATA": filepath.Join(c.home, "AppData", "Roaming"),
		"LOCALAPPDATA": filepath.Join(c.home, "AppData", "Local"), "GIT_CONFIG_NOSYSTEM": "1",
		"GIT_CONFIG_GLOBAL": filepath.Join(c.root, "gitconfig"), "GIT_TERMINAL_PROMPT": "0", "NO_COLOR": "1",
	}
	var environment []string
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		upper := strings.ToUpper(key)
		_, replaced := values[upper]
		if !replaced && !strings.HasPrefix(upper, "GIT_") && !strings.HasPrefix(upper, "DAYNIGHT_") && !strings.HasPrefix(upper, "GH_") && !strings.HasPrefix(upper, "GITHUB_") && !strings.HasPrefix(upper, "COPILOT_") && upper != "NODE_OPTIONS" {
			environment = append(environment, entry)
		}
	}
	for key, value := range values {
		environment = append(environment, key+"="+value)
	}
	return environment
}

func (c *acceptanceCLI) git(t *testing.T, arguments ...string) string {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "git", arguments...)
	command.Dir, command.Env = c.root, c.environment()
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("owned Git fixture failed: %v: %s", err, output)
	}
	return strings.TrimSpace(string(output))
}

type acceptanceCLIOutput struct{ bytes.Buffer }

func (b *acceptanceCLIOutput) Write(value []byte) (int, error) {
	if b.Len()+len(value) > 4<<20 {
		return 0, errors.New("installed CLI output exceeded its acceptance capture bound")
	}
	return b.Buffer.Write(value)
}

type acceptanceCLIResult struct {
	status         int
	stdout, stderr string
	err            error
}

func (c *acceptanceCLI) start(t *testing.T, cwd string, arguments ...string) <-chan acceptanceCLIResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	command := exec.CommandContext(ctx, c.receipt.NodePath, append([]string{c.receipt.EntryPath}, arguments...)...)
	command.Dir, command.Env, command.WaitDelay = cwd, c.environment(), time.Second
	command.Cancel = func() error { return command.Process.Signal(os.Interrupt) }
	stdout, stderr := &acceptanceCLIOutput{}, &acceptanceCLIOutput{}
	command.Stdout, command.Stderr = stdout, stderr
	if err := command.Start(); err != nil {
		cancel()
		t.Fatal("cannot start installed CLI")
	}
	done, result := make(chan struct{}), make(chan acceptanceCLIResult, 1)
	t.Cleanup(func() {
		cancel()
		select {
		case <-done:
		case <-time.After(3 * time.Second):
			t.Error("installed CLI process was not reaped during cleanup")
		}
	})
	if err := binaryAcceptance.update(func() { c.scenario.CLIProcessesStarted++ }); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		close(done)
		t.Fatal("cannot persist installed CLI start receipt")
	}
	go func() {
		defer close(done)
		defer cancel()
		err := command.Wait()
		status := command.ProcessState.ExitCode()
		var exitError *exec.ExitError
		if err != nil && errors.As(err, &exitError) {
			err = nil
		}
		if updateError := binaryAcceptance.update(func() { c.scenario.CLIProcessesReaped++ }); updateError != nil {
			err = errors.Join(err, errors.New("cannot persist installed CLI reap receipt"))
		}
		result <- acceptanceCLIResult{status: status, stdout: stdout.String(), stderr: stderr.String(), err: err}
	}()
	return result
}

func acceptanceCLIReceive(t *testing.T, pending <-chan acceptanceCLIResult) acceptanceCLIResult {
	t.Helper()
	select {
	case result := <-pending:
		if result.err != nil {
			t.Fatalf("installed CLI execution failed: %v", result.err)
		}
		return result
	case <-time.After(18 * time.Second):
		t.Fatal("installed CLI exceeded its operation bound")
		return acceptanceCLIResult{}
	}
}

func (c *acceptanceCLI) run(t *testing.T, cwd string, arguments ...string) string {
	t.Helper()
	result := acceptanceCLIReceive(t, c.start(t, cwd, arguments...))
	if result.status != 0 || result.stderr != "" {
		t.Fatalf("installed CLI operation failed (%d): %s", result.status, result.stderr)
	}
	return result.stdout
}

func acceptanceCLIJSON[T any](t *testing.T, text string) T {
	t.Helper()
	var result T
	decoder := json.NewDecoder(strings.NewReader(text))
	if err := decoder.Decode(&result); err != nil {
		t.Fatalf("installed CLI did not return valid JSON: %v", err)
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		t.Fatal("installed CLI JSON output contains trailing data")
	}
	return result
}

func acceptanceCLIResourceID(t *testing.T, text string) string {
	t.Helper()
	for _, line := range strings.Split(text, "\n") {
		if id, found := strings.CutPrefix(line, "ID: "); found && len(id) == 36 {
			return id
		}
	}
	t.Fatal("installed CLI mutation did not return a resource ID")
	return ""
}

func (c *acceptanceCLI) task(t *testing.T, id string) api.Task {
	t.Helper()
	return acceptanceCLIJSON[api.Task](t, c.run(t, filepath.Join(c.repo, "source"), "task", "show", id, "--json"))
}

func acceptanceCLIPatches(process *acceptanceProcess) []acceptanceCLIRequest {
	process.logs.mu.Lock()
	defer process.logs.mu.Unlock()
	var requests []acceptanceCLIRequest
	for _, event := range process.logs.events {
		if event["type"] == "http_request" && event["method"] == "PATCH" {
			id, _ := event["request_id"].(string)
			status, _ := event["status"].(float64)
			requests = append(requests, acceptanceCLIRequest{RequestID: id, Status: int(status)})
		}
	}
	return requests
}

func acceptanceCLIWaitPatches(t *testing.T, process *acceptanceProcess, count int) []acceptanceCLIRequest {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := acceptanceEventually(ctx, func() (bool, error) { return len(acceptanceCLIPatches(process)) >= count, nil }); err != nil {
		t.Fatal("installed CLI mutations did not complete their server request logs")
	}
	return acceptanceCLIPatches(process)
}

func (c *acceptanceCLI) refuse(t *testing.T, process *acceptanceProcess, code, taskID string, arguments ...string) {
	t.Helper()
	before := len(acceptanceCLIPatches(process))
	result := acceptanceCLIReceive(t, c.start(t, c.repo, arguments...))
	if result.status != 1 || result.stdout != "" || !strings.Contains(result.stderr, code) || !strings.Contains(result.stderr, taskID) {
		t.Fatalf("installed CLI refusal lost its code, task ID or exit behavior: %+v", result)
	}
	requests := acceptanceCLIWaitPatches(t, process, before+1)
	if len(requests) != before+1 || requests[before].Status != 409 || requests[before].RequestID == "" || !strings.Contains(result.stderr, "requestId="+requests[before].RequestID) {
		t.Fatal("installed CLI refusal retried or lost the actual server request identity")
	}
	if err := binaryAcceptance.update(func() {
		c.scenario.CLIRefusalRequestIDs = append(c.scenario.CLIRefusalRequestIDs, requests[before].RequestID)
	}); err != nil {
		t.Fatal("cannot persist installed CLI refusal identity")
	}
}

func TestInstalledCLIProjectTaskAcceptance(t *testing.T) {
	receipt := readAcceptanceCLI(t)
	acceptanceCase(t, "installed_cli_project_task_workflow", []string{"PT.V1", "PT.V3", "PT.V5", "PT.V6", "PT.V7", "PT.V8", "PT.V9", "PT.V10"}, func(t *testing.T, scenario *acceptanceScenario) {
		fixture := newAcceptanceFixture(t, scenario)
		cli := newAcceptanceCLI(t, receipt, scenario)
		if version := cli.run(t, cli.caller, "--version"); version != receipt.PackageVersion+"\n" {
			t.Fatal("fresh installed CLI version differs from its validated manifest")
		}
		process := fixture.launch(t, nil).started(t)
		if err := os.WriteFile(filepath.Join(cli.home, ".daynight", "config.yml"), []byte("serverUrl: http://"+process.address+"\n"), 0o600); err != nil {
			t.Fatal("cannot configure isolated installed CLI")
		}
		projectID := acceptanceCLIResourceID(t, cli.run(t, filepath.Join(cli.repo, "source"), "project", "create", "Installed CLI 项目"))
		for _, arguments := range [][]string{
			{"project", "create", "Preserve existing name"},
			{"project", "create", "Explicit existing project", "--repo", "https://Git.Example/Org/Repo.git"},
		} {
			output := cli.run(t, cli.repo, arguments...)
			if !strings.HasPrefix(output, "Project already exists.\n") || acceptanceCLIResourceID(t, output) != projectID {
				t.Fatal("installed project creation did not return the existing repository project")
			}
		}
		project := acceptanceCLIJSON[api.Project](t, cli.run(t, cli.caller, "project", "show", projectID, "--json"))
		projects := acceptanceCLIJSON[[]api.Project](t, cli.run(t, cli.caller, "project", "list", "--json"))
		if len(projects) != 1 || !reflect.DeepEqual(projects[0], project) || project.Name != "Installed CLI 项目" || project.RepoURL != "git@git.example:Org/Repo.git" {
			t.Fatal("installed project commands disagree with the created resource")
		}
		if _, err := os.Stat(filepath.Join(cli.repo, ".daynight")); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("installed project creation wrote repository binding metadata")
		}
		first := acceptanceCLIResourceID(t, cli.run(t, filepath.Join(cli.repo, "source"), "task", "create", "--title", "前置 Task", "--description", "Persistent description"))
		bindingPath := filepath.Join(cli.repo, ".daynight", "project.yml")
		binding, err := os.ReadFile(bindingPath)
		if err != nil || !bytes.Contains(binding, []byte("repoIdentity: git.example/Org/Repo\n")) || !bytes.Contains(binding, []byte("projectId: "+projectID+"\n")) || !bytes.Contains(binding, []byte("serverUrl: http://"+process.address+"\n")) {
			t.Fatal("installed CLI did not persist its discovered repository association")
		}
		cli.git(t, "-C", cli.repo, "check-ignore", "--quiet", ".daynight/project.yml")
		if entries, err := os.ReadDir(filepath.Dir(bindingPath)); err != nil || len(entries) != 1 || entries[0].Name() != "project.yml" {
			t.Fatal("installed discovery left an unexpected metadata file or lock")
		}
		second := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "Alternate"))
		target := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "Dependent", "--depends-on", first))
		blocked := cli.task(t, target)
		if blocked.Version != 1 || blocked.Status != "todo" || blocked.Ready || !slices.Equal(blocked.DependsOn, []string{first}) || !slices.Equal(blocked.BlockedBy, []string{first}) {
			t.Fatal("installed task creation lost its server dependency projection")
		}
		cli.refuse(t, process, "dependency_unsatisfied", first, "task", "update", target, "--status", "in_progress")
		cli.run(t, cli.repo, "task", "update", first, "--status", "done")
		ready := acceptanceCLIJSON[[]api.Task](t, cli.run(t, cli.repo, "task", "list", "--status", "todo", "--ready", "--json"))
		readyIDs := make([]string, len(ready))
		for index, task := range ready {
			readyIDs[index] = task.ID
		}
		slices.Sort(readyIDs)
		expectedReady := []string{second, target}
		slices.Sort(expectedReady)
		if !slices.Equal(readyIDs, expectedReady) {
			t.Fatal("installed ready and status filters did not intersect")
		}
		cli.run(t, cli.repo, "task", "update", target, "--status", "in_progress", "--description", "Completed description")
		cli.refuse(t, process, "dependency_unsatisfied", target, "task", "update", first, "--status", "todo")
		cli.run(t, cli.repo, "task", "update", target, "--status", "done", "--description", "")
		if task := cli.task(t, target); task.Version != 3 || task.Description != "" || task.Status != "done" {
			t.Fatal("installed update did not clear description or advance the expected version")
		}
		editable := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "Editable", "--depends-on", first))
		cli.run(t, cli.repo, "task", "update", editable, "--depends-on", second)
		if task := cli.task(t, editable); !slices.Equal(task.DependsOn, []string{second}) || task.Ready {
			t.Fatal("installed dependency update did not replace the full set")
		}
		cli.refuse(t, process, "dependency_cycle", editable, "task", "update", second, "--depends-on", editable)
		cli.run(t, cli.repo, "task", "update", editable, "--clear-dependencies")
		if task := cli.task(t, editable); len(task.DependsOn) != 0 || !task.Ready {
			t.Fatal("installed dependency clear left a dependency or blocked state")
		}
		fixture.exec(t, "UPDATE tasks SET version=$1 WHERE id=$2", int64(9_007_199_254_740_993), editable)
		cli.run(t, cli.caller, "task", "update", editable, "--project", projectID, "--if-version", "9007199254740993", "--title", "Exact version 中文")
		cli.run(t, cli.repo, "task", "update", editable, "--title", "Read exact version")
		if task := cli.task(t, editable); task.Version != 9_007_199_254_740_995 {
			t.Fatal("installed CLI rounded an explicit or read Go int64 version")
		}
		cli.git(t, "-C", cli.repo, "remote", "set-url", "origin", "ssh://git@GIT.EXAMPLE:22/Org/Repo.git")
		duplicate := acceptanceDecode[api.Project](t, process.request(context.Background(), http.MethodPost, "/api/v1/projects", api.CreateProjectRequest{Name: "Later duplicate", RepoURL: "https://git.example/Org/Repo"}, ""), http.StatusCreated)
		if duplicate.ID == projectID {
			t.Fatal("server duplicate fixture reused the original project")
		}
		if task := cli.task(t, editable); task.ProjectID != projectID {
			t.Fatal("equivalent origin or later duplicate changed a validated binding")
		}
		if after, err := os.ReadFile(bindingPath); err != nil || !bytes.Equal(after, binding) {
			t.Fatal("explicit project or equivalent origin rewrote the repository association")
		}
		beforePatches := len(acceptanceCLIPatches(process))
		version := strconv.FormatInt(cli.task(t, editable).Version, 10)
		barrier := fixture.projectLock(t, projectID)
		left := cli.start(t, cli.caller, "task", "update", editable, "--project", projectID, "--if-version", version, "--title", "Concurrent left")
		right := cli.start(t, cli.caller, "task", "update", editable, "--project", projectID, "--if-version", version, "--title", "Concurrent right")
		fixture.waitWriters(t, process, 2)
		acceptanceRelease(t, barrier)
		results := []acceptanceCLIResult{acceptanceCLIReceive(t, left), acceptanceCLIReceive(t, right)}
		requests := acceptanceCLIWaitPatches(t, process, beforePatches+2)
		if len(requests) != beforePatches+2 {
			t.Fatal("installed concurrent writers retried a mutation")
		}
		requests = requests[beforePatches:]
		winners, conflicts := 0, 0
		for _, result := range results {
			if result.status == 0 && result.stderr == "" {
				winners++
				continue
			}
			if result.status == 1 && result.stdout == "" && strings.Contains(result.stderr, "version_conflict") && strings.Contains(result.stderr, editable) {
				conflicts++
				matched := false
				for _, request := range requests {
					if request.Status == 409 && request.RequestID != "" && strings.Contains(result.stderr, "requestId="+request.RequestID) {
						matched = true
					}
				}
				if !matched {
					t.Fatal("installed CLI version conflict lost its server request identity")
				}
				continue
			}
			t.Fatalf("unexpected installed CLI concurrent writer result: %+v", result)
		}
		if winners != 1 || conflicts != 1 || requests[0].RequestID == requests[1].RequestID {
			t.Fatal("installed CLI concurrent same-version writers did not yield one success and one conflict")
		}
		statuses := []int{requests[0].Status, requests[1].Status}
		slices.Sort(statuses)
		if !slices.Equal(statuses, []int{200, 409}) {
			t.Fatal("concurrent installed CLI requests lost their exact HTTP statuses")
		}
		if err := binaryAcceptance.update(func() { scenario.ConcurrentCLIRequests = requests }); err != nil {
			t.Fatal("cannot persist concurrent installed CLI requests")
		}
		before := cli.task(t, editable)
		if before.Version != 9_007_199_254_740_996 || before.Title != "Concurrent left" && before.Title != "Concurrent right" {
			t.Fatal("concurrent installed CLI writers persisted an unexpected version or title")
		}
		graph := acceptanceCLIJSON[api.TaskGraph](t, cli.run(t, cli.repo, "task", "graph", "--json"))
		expectedGraph := acceptanceDecode[api.TaskGraph](t, process.request(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID+"/task-graph", nil, ""), http.StatusOK)
		if !reflect.DeepEqual(graph, expectedGraph) {
			t.Fatal("installed CLI graph omitted or changed server response fields")
		}
		if graph.Project.ID != projectID || graph.Summary.Total != 4 || graph.Summary.Done != 2 || graph.Summary.Todo != 2 || graph.Summary.Ready != 2 || len(graph.Tasks) != 4 {
			t.Fatal("installed CLI graph lost the complete server summary or tasks")
		}
		firstBefore, targetBefore := cli.task(t, first), cli.task(t, target)
		process.signal(t)
		process.stopped(t, 0)
		restarted := fixture.launch(t, map[string]string{"DAYNIGHT_LISTEN_ADDR": process.address}).started(t)
		if restarted.address != process.address {
			t.Fatal("restarted real service did not reuse its released address")
		}
		if after := cli.task(t, editable); !reflect.DeepEqual(after, before) {
			t.Fatal("installed CLI task data did not persist across actual process restart")
		}
		if after := cli.task(t, first); !reflect.DeepEqual(after, firstBefore) || after.Description != "Persistent description" {
			t.Fatal("installed CLI prerequisite description did not persist across restart")
		}
		if after := cli.task(t, target); !reflect.DeepEqual(after, targetBefore) || !slices.Equal(after.DependsOn, []string{first}) {
			t.Fatal("installed CLI completed dependency did not persist across restart")
		}
		if after := acceptanceCLIJSON[api.Project](t, cli.run(t, cli.caller, "project", "show", projectID, "--json")); !reflect.DeepEqual(after, project) {
			t.Fatal("installed CLI project did not persist across actual process restart")
		}
		if after := acceptanceCLIJSON[api.TaskGraph](t, cli.run(t, cli.repo, "task", "graph", "--json")); !reflect.DeepEqual(after, graph) {
			t.Fatal("installed CLI complete graph changed across actual process restart")
		}
		restarted.signal(t)
		restarted.stopped(t, 0)
	})
}
