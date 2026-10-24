package main

import (
	"context"
	"net/http"
	"reflect"
	"strconv"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/api"
)

func acceptanceCLIPlatforms(t *testing.T, cli *acceptanceCLI, process *acceptanceProcess) {
	t.Helper()
	project := acceptanceDecode[api.Project](t, process.request(context.Background(), http.MethodPost, "/api/v1/projects", api.CreateProjectRequest{Name: "Installed task platforms", RepoURL: "https://github.com/example/platforms"}, "platform-installed-project"), http.StatusCreated)
	read := func(id string) api.Task {
		return acceptanceCLITaskResource(t, cli.run(t, cli.caller, "task", "show", id, "--project", project.ID, "--json"))
	}
	create := func(platform string) api.Task {
		arguments := []string{"task", "create", "--project", project.ID, "--title", "Platform candidate"}
		if platform != "" {
			arguments = append(arguments, "--required-platform", platform)
		}
		task := read(acceptanceCLIResourceID(t, cli.run(t, cli.caller, arguments...)))
		if platform == "" && task.RequiredPlatform != nil || platform != "" && (task.RequiredPlatform == nil || *task.RequiredPlatform != platform) {
			t.Fatal("installed creation lost required platform")
		}
		cli.run(t, cli.caller, "task", "update", task.ID, "--project", project.ID, "--if-version", strconv.FormatInt(task.Version, 10), "--allow-agents", "true")
		task = read(task.ID)
		cli.run(t, cli.caller, "task", "approve", task.ID, "--project", project.ID, "--if-version", strconv.FormatInt(task.Version, 10))
		return read(task.ID)
	}
	windows := create("windows")
	linux := create("linux")
	unrestricted := create("")
	create("macos")
	ready := acceptanceCLIJSON[[]api.Task](t, cli.run(t, cli.caller, "task", "ready", "--project", project.ID, "--allow-agents", "true", "--compatible-platform", "linux", "--limit", "1", "--json"))
	if !reflect.DeepEqual(ready, []api.Task{linux}) {
		t.Fatal("installed bounded query hid later compatible task")
	}
	acceptanceCLITaskListJSON(t, cli.run(t, cli.caller, "task", "list", "--project", project.ID, "--ready", "--allow-agents", "true", "--compatible-platform", "linux", "--json"), []api.Task{linux, unrestricted})
	cli.run(t, cli.caller, "task", "update", windows.ID, "--project", project.ID, "--if-version", strconv.FormatInt(windows.Version, 10), "--required-platform", "windows")
	if got := read(windows.ID); !reflect.DeepEqual(got, windows) {
		t.Fatal("installed same platform update changed resource")
	}
	cli.refuse(t, process, "version_conflict", windows.ID, "task", "update", windows.ID, "--project", project.ID, "--if-version", strconv.FormatInt(windows.Version-1, 10), "--required-platform", "windows")
	cli.run(t, cli.caller, "task", "update", windows.ID, "--project", project.ID, "--if-version", strconv.FormatInt(windows.Version, 10), "--clear-required-platform")
	cleared := read(windows.ID)
	if cleared.RequiredPlatform != nil || !cleared.AllowAgents || cleared.Status != windows.Status || cleared.Version != windows.Version+1 {
		t.Fatal("installed clear changed unrelated state")
	}
	cli.run(t, cli.caller, "task", "claim", linux.ID, "--project", project.ID, "--if-version", strconv.FormatInt(linux.Version, 10))
	active := read(linux.ID)
	if active.RequiredPlatform == nil || *active.RequiredPlatform != "linux" || active.StartedAt == nil {
		t.Fatal("installed manual claim lost platform or timing")
	}
	cli.refuse(t, process, "invalid_transition", "", "task", "update", active.ID, "--project", project.ID, "--if-version", strconv.FormatInt(active.Version, 10), "--clear-required-platform")
	if got := read(active.ID); !reflect.DeepEqual(got, active) {
		t.Fatal("installed locked platform changed actual task")
	}
	graph := acceptanceCLIGraphResource(t, cli.run(t, cli.caller, "task", "graph", "--project", project.ID, "--json"))
	for _, task := range graph.Tasks {
		if task.ID == active.ID && (task.RequiredPlatform == nil || *task.RequiredPlatform != "linux") {
			t.Fatal("installed graph lost platform")
		}
	}
}
