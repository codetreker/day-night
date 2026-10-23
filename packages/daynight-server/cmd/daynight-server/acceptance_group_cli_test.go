package main

import (
	"context"
	"net/http"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/api"
)

func TestInstalledCLITaskGroupAcceptance(t *testing.T) {
	receipt := readAcceptanceCLI(t)
	acceptanceCase(t, "installed_cli_explicit_task_groups_restart", []string{"PT.V10", "ST-T3.AC1", "ST-T3.AC4"}, func(t *testing.T, scenario *acceptanceScenario) {
		fixture := newAcceptanceFixture(t, scenario)
		cli := newAcceptanceCLI(t, receipt, scenario)
		evidence := newLifecycleEvidence(t, scenario)
		process := fixture.launch(t, nil).started(t)
		cli.configure(t, process)
		projectID := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "project", "create", "Explicit task groups"))
		anchorID := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "Group anchor"))
		externalID := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "External prerequisite"))
		memberID := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "Group member", "--description", "Preserve explicit membership.", "--group-id", anchorID, "--depends-on", externalID))
		disconnectedID := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "Disconnected member", "--group-id", anchorID))
		anchor, external, member, disconnected := cli.task(t, anchorID), cli.task(t, externalID), cli.task(t, memberID), cli.task(t, disconnectedID)
		if anchor.GroupID != anchor.ID || external.GroupID != external.ID || member.GroupID != anchor.ID || disconnected.GroupID != anchor.ID || len(disconnected.DependsOn) != 0 {
			t.Fatal("installed CLI did not persist explicit groups independently of dependencies")
		}
		for _, output := range []string{cli.run(t, cli.repo, "task", "show", member.ID), cli.run(t, cli.repo, "task", "list"), cli.run(t, cli.repo, "task", "graph")} {
			if !strings.Contains(output, "Group ID: "+anchor.ID+"\n") {
				t.Fatal("installed task text output omitted the group identifier")
			}
		}
		acceptanceCLIRefusal(t, cli, process, evidence, anchor, http.StatusBadRequest, "invalid_input", "task", "update", anchor.ID, "--project", projectID, "--group-id", external.ID, "--if-version", strconv.FormatInt(anchor.Version, 10))
		cli.run(t, cli.repo, "task", "update", member.ID, "--clear-dependencies", "--if-version", strconv.FormatInt(member.Version, 10))
		member = cli.task(t, member.ID)
		if member.GroupID != anchor.ID || len(member.DependsOn) != 0 {
			t.Fatal("installed dependency replacement changed explicit membership")
		}
		for _, step := range []struct{ action, status string }{{"approve", "todo"}, {"claim", "in_progress"}, {"complete", "done"}} {
			member = acceptanceCLIAction(t, cli, process, evidence, member, step.action, step.status)
			if member.GroupID != anchor.ID {
				t.Fatal("installed lifecycle action changed explicit group membership")
			}
		}
		beforeMove := member
		cli.run(t, cli.repo, "task", "update", member.ID, "--group-id", external.ID, "--if-version", strconv.FormatInt(member.Version, 10))
		member = cli.task(t, member.ID)
		if member.GroupID != external.ID || member.Version != beforeMove.Version+1 || member.Status != "done" {
			t.Fatal("installed group reassignment lost versioned task metadata")
		}
		acceptanceCLIRefusal(t, cli, process, evidence, member, http.StatusConflict, "version_conflict", "task", "update", member.ID, "--project", projectID, "--group-id", anchor.ID, "--if-version", strconv.FormatInt(beforeMove.Version, 10))
		cli.run(t, cli.repo, "task", "update", member.ID, "--group-id", member.ID, "--if-version", strconv.FormatInt(member.Version, 10))
		member = cli.task(t, member.ID)
		if member.GroupID != member.ID {
			t.Fatal("installed explicit split did not create a task-owned group")
		}
		graph := acceptanceCLIJSON[api.TaskGraph](t, cli.run(t, cli.repo, "task", "graph", "--json"))
		expectedGraph := acceptanceDecode[api.TaskGraph](t, process.request(context.Background(), http.MethodGet, "/api/v1/projects/"+projectID+"/task-graph", nil, ""), http.StatusOK)
		if !reflect.DeepEqual(graph, expectedGraph) || len(graph.Tasks) != 4 || graph.Tasks[2].GroupID != member.ID || graph.Tasks[3].GroupID != anchor.ID {
			t.Fatal("installed graph lost explicit group identifiers")
		}
		process.signal(t)
		process.stopped(t, 0)
		restarted := fixture.launch(t, map[string]string{"DAYNIGHT_LISTEN_ADDR": process.address}).started(t)
		for _, before := range []api.Task{anchor, external, member, disconnected} {
			if after := cli.task(t, before.ID); !reflect.DeepEqual(after, before) {
				t.Fatal("explicit group membership changed across service restart")
			}
		}
		if after := acceptanceCLIJSON[api.TaskGraph](t, cli.run(t, cli.repo, "task", "graph", "--json")); !reflect.DeepEqual(after, graph) {
			t.Fatal("explicit graph membership changed across service restart")
		}
		restarted.signal(t)
		restarted.stopped(t, 0)
	})
}
