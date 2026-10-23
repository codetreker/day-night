package service

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/google/uuid"
)

func TestTaskGroupMembershipSurvivesDependenciesAndLifecycle(t *testing.T) {
	tasks, _, project, _, principal := taskService(t)
	ctx := context.Background()
	anchor := createTask(t, tasks, principal, project.ID, "Group anchor")
	external := createTask(t, tasks, principal, project.ID, "External prerequisite")
	if anchor.GroupID != anchor.ID || external.GroupID != external.ID {
		t.Fatalf("new tasks did not anchor their own groups: %#v %#v", anchor, external)
	}
	member, err := tasks.Create(ctx, principal, project.ID, CreateTask{
		Title: "Group member", GroupID: pointer(strings.ToUpper(anchor.ID)), DependsOn: []string{external.ID},
	})
	if err != nil || member.GroupID != anchor.ID {
		t.Fatalf("explicit group creation: %#v, %v", member, err)
	}
	member = updateTask(t, tasks, principal, member, UpdateTask{DependsOn: pointer([]string{})})
	anchor = updateTask(t, tasks, principal, anchor, UpdateTask{DependsOn: pointer([]string{external.ID})})
	if member.GroupID != anchor.ID || anchor.GroupID != anchor.ID {
		t.Fatal("dependency replacement changed explicit membership")
	}
	for _, action := range []func(*testing.T, *Tasks, core.Principal, core.Task) core.Task{approveTask, claimTask, completeTask} {
		member = action(t, tasks, principal, member)
		if member.GroupID != anchor.ID {
			t.Fatalf("lifecycle action changed group: %#v", member)
		}
	}
	page, err := tasks.List(ctx, principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 10}})
	if err != nil || len(page.Items) != 3 || page.Items[1].GroupID != external.ID || page.Items[2].GroupID != anchor.ID {
		t.Fatalf("list lost explicit group membership: %#v, %v", page, err)
	}
	graph, err := tasks.Graph(ctx, principal, project.ID)
	if err != nil || len(graph.Tasks) != 3 || graph.Tasks[0].GroupID != anchor.ID || graph.Tasks[2].GroupID != anchor.ID {
		t.Fatalf("graph lost explicit group membership: %#v, %v", graph, err)
	}
	moved := updateTask(t, tasks, principal, member, UpdateTask{GroupID: pointer(external.ID)})
	if moved.GroupID != external.ID || moved.Status != member.Status || moved.Version != member.Version+1 || !reflect.DeepEqual(moved.DependsOn, member.DependsOn) {
		t.Fatalf("explicit reassignment changed unrelated fields: %#v", moved)
	}
	_, err = tasks.Update(ctx, principal, project.ID, moved.ID, UpdateTask{Version: member.Version, GroupID: pointer(anchor.ID)})
	requireFault(t, err, "version_conflict")
	assertTaskUnchanged(t, tasks, principal, moved)
	noop := updateTask(t, tasks, principal, moved, UpdateTask{GroupID: pointer(strings.ToUpper(external.ID))})
	if !reflect.DeepEqual(noop, moved) {
		t.Fatalf("same-group update changed task version: %#v %#v", noop, moved)
	}
	split := updateTask(t, tasks, principal, moved, UpdateTask{GroupID: pointer(moved.ID)})
	if split.GroupID != split.ID || split.Version != moved.Version+1 {
		t.Fatalf("member did not become its own group anchor: %#v", split)
	}
	anchor = updateTask(t, tasks, principal, anchor, UpdateTask{GroupID: pointer(external.ID)})
	if anchor.GroupID != external.ID {
		t.Fatalf("empty anchor could not join another group: %#v", anchor)
	}
}

func TestTaskGroupReferencesAndAnchorOwnership(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	ctx := context.Background()
	anchor := createTask(t, tasks, principal, project.ID, "Anchor")
	other := createTask(t, tasks, principal, project.ID, "Other anchor")
	member, err := tasks.Create(ctx, principal, project.ID, CreateTask{Title: "Member", GroupID: &anchor.ID})
	if err != nil {
		t.Fatal(err)
	}
	foreignProject, err := NewProjects(database).Create(ctx, principal, CreateProject{Name: "Foreign", RepoURL: "https://example.com/foreign"})
	if err != nil {
		t.Fatal(err)
	}
	foreign := createTask(t, tasks, principal, foreignProject.ID, "Foreign anchor")
	for _, groupID := range []string{"", "invalid", uuid.NewString(), foreign.ID, member.ID} {
		t.Run(groupID, func(t *testing.T) {
			_, err := tasks.Create(ctx, principal, project.ID, CreateTask{Title: "Refused", GroupID: &groupID})
			requireFault(t, err, "invalid_input")
			_, err = tasks.Update(ctx, principal, project.ID, other.ID, UpdateTask{Version: other.Version, GroupID: &groupID})
			requireFault(t, err, "invalid_input")
			assertTaskUnchanged(t, tasks, principal, other)
		})
	}
	_, err = tasks.Update(ctx, principal, project.ID, anchor.ID, UpdateTask{Version: anchor.Version, GroupID: &other.ID})
	requireFault(t, err, "invalid_input")
	assertTaskUnchanged(t, tasks, principal, anchor)
	assertTaskUnchanged(t, tasks, principal, member)
	noop := updateTask(t, tasks, principal, anchor, UpdateTask{GroupID: &anchor.ID})
	if !reflect.DeepEqual(noop, anchor) {
		t.Fatal("retaining a populated anchor changed its version")
	}
}

func TestTaskGroupJoinAndAnchorMoveCannotOrphanMembers(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	anchor := createTask(t, tasks, principal, project.ID, "Anchor")
	other := createTask(t, tasks, principal, project.ID, "Other anchor")
	results := competeTaskWrites(t, database, project.ID,
		func(ctx context.Context) (core.Task, error) {
			return tasks.Create(ctx, principal, project.ID, CreateTask{Title: "Joining member", GroupID: &anchor.ID})
		},
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, principal, project.ID, anchor.ID, UpdateTask{Version: anchor.Version, GroupID: &other.ID})
		})
	assertOneTaskWinner(t, results, "invalid_input")
	page, err := tasks.List(context.Background(), principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 10}})
	if err != nil {
		t.Fatal(err)
	}
	byID := make(map[string]core.Task, len(page.Items))
	for _, task := range page.Items {
		byID[task.ID] = task
	}
	for _, task := range page.Items {
		group, exists := byID[task.GroupID]
		if !exists || group.GroupID != group.ID {
			t.Fatalf("concurrent writes orphaned group membership: %#v", page.Items)
		}
	}
}

func TestTaskGroupQueryFailuresPreserveCancellation(t *testing.T) {
	for _, operation := range []string{"anchor lookup", "member lookup"} {
		t.Run(operation, func(t *testing.T) {
			tasks, _, project, databaseURL, principal := taskService(t)
			anchor := createTask(t, tasks, principal, project.ID, "Anchor")
			other := createTask(t, tasks, principal, project.ID, "Other")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			traced := tracedTasks(t, databaseURL, taskQueryAction{
				match: func(sql string) bool {
					if operation == "member lookup" {
						return strings.Contains(sql, "group_id = $2")
					}
					return strings.Contains(sql, "FROM tasks t")
				},
				start: cancel,
			})
			var err error
			if operation == "anchor lookup" {
				_, err = traced.Create(ctx, principal, project.ID, CreateTask{Title: "Refused", GroupID: &anchor.ID})
			} else {
				_, err = traced.Update(ctx, principal, project.ID, anchor.ID, UpdateTask{Version: anchor.Version, GroupID: &other.ID})
			}
			assertOperational(t, err)
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("group lookup lost cancellation: %v", err)
			}
			assertTaskUnchanged(t, tasks, principal, anchor)
		})
	}
}
