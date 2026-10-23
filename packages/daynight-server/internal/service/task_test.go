package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
	"github.com/google/uuid"
)

func taskService(t *testing.T) (*Tasks, *store.Store, core.Project, string, core.Principal) {
	t.Helper()
	projects, database, databaseURL, principal := projectService(t)
	project, err := projects.Create(context.Background(), principal, CreateProject{Name: "Tasks", RepoURL: "git@host:repo"})
	if err != nil {
		t.Fatal(err)
	}
	return NewTasks(database), database, project, databaseURL, principal
}

func createTask(t *testing.T, tasks *Tasks, principal core.Principal, projectID, title string, dependencies ...string) core.Task {
	t.Helper()
	task, err := tasks.Create(context.Background(), principal, projectID, CreateTask{Title: title, DependsOn: dependencies})
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func updateTask(t *testing.T, tasks *Tasks, principal core.Principal, task core.Task, input UpdateTask) core.Task {
	t.Helper()
	input.Version = task.Version
	updated, err := tasks.Update(context.Background(), principal, task.ProjectID, task.ID, input)
	if err != nil {
		t.Fatal(err)
	}
	return updated
}

func approveTask(t *testing.T, tasks *Tasks, principal core.Principal, task core.Task) core.Task {
	t.Helper()
	approved, err := tasks.Approve(context.Background(), principal, task.ProjectID, task.ID, task.Version)
	if err != nil {
		t.Fatal(err)
	}
	return approved
}

func claimTask(t *testing.T, tasks *Tasks, principal core.Principal, task core.Task) core.Task {
	t.Helper()
	claimed, err := tasks.Claim(context.Background(), principal, task.ProjectID, task.ID, task.Version)
	if err != nil {
		t.Fatal(err)
	}
	return claimed
}

func completeTask(t *testing.T, tasks *Tasks, principal core.Principal, task core.Task) core.Task {
	t.Helper()
	completed, err := tasks.Complete(context.Background(), principal, task.ProjectID, task.ID, task.Version)
	if err != nil {
		t.Fatal(err)
	}
	return completed
}

func pointer[T any](value T) *T { return &value }

func assertTaskUnchanged(t *testing.T, tasks *Tasks, principal core.Principal, before core.Task) {
	t.Helper()
	after, err := tasks.Get(context.Background(), principal, before.ProjectID, before.ID)
	if err != nil || !reflect.DeepEqual(after, before) {
		t.Fatalf("refused operation changed task: before %#v, after %#v, err %v", before, after, err)
	}
}

func TestTaskCreateReadAndDerivedState(t *testing.T) {
	tasks, _, project, _, principal := taskService(t)
	empty, err := tasks.List(context.Background(), principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 50}})
	if err != nil || empty.Items == nil || len(empty.Items) != 0 || empty.NextCursor != nil {
		t.Fatalf("empty task page: %#v, %v", empty, err)
	}
	first := createTask(t, tasks, principal, project.ID, "First")
	second := createTask(t, tasks, principal, project.ID, "Second")
	dependencies := []string{strings.ToUpper(second.ID), strings.ToUpper(first.ID)}
	created, err := tasks.Create(context.Background(), principal, strings.ToUpper(project.ID), CreateTask{Title: "  Third  ", Description: "Description", DependsOn: dependencies})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{first.ID, second.ID}
	slices.Sort(want)
	if created.Status != core.TaskProposed || created.Version != 1 || created.Title != "  Third  " || created.Description != "Description" || created.Ready ||
		!slices.Equal(created.DependsOn, want) || !slices.Equal(created.BlockedBy, want) || created.CreatedAt.IsZero() || !created.CreatedAt.Equal(created.UpdatedAt) {
		t.Fatalf("created task: %#v", created)
	}
	if first.DependsOn == nil || first.BlockedBy == nil || first.Ready || first.Description != "" {
		t.Fatalf("task defaults: %#v", first)
	}
	got, err := tasks.Get(context.Background(), principal, strings.ToUpper(project.ID), strings.ToUpper(created.ID))
	if err != nil || !reflect.DeepEqual(got, created) {
		t.Fatalf("canonical read: %#v, %v", got, err)
	}
	approved := approveTask(t, tasks, principal, created)
	if approved.Ready || !slices.Equal(approved.BlockedBy, want) {
		t.Fatalf("approval completed prerequisites: %#v", approved)
	}
	first = approveTask(t, tasks, principal, first)
	first = claimTask(t, tasks, principal, first)
	first = completeTask(t, tasks, principal, first)
	second = approveTask(t, tasks, principal, second)
	second = claimTask(t, tasks, principal, second)
	second = completeTask(t, tasks, principal, second)
	ready, err := tasks.Get(context.Background(), principal, project.ID, created.ID)
	if err != nil || !ready.Ready || len(ready.BlockedBy) != 0 || ready.Version != approved.Version || !ready.UpdatedAt.Equal(approved.UpdatedAt) {
		t.Fatalf("derived readiness must not mutate metadata: %#v, %v", ready, err)
	}
	started := claimTask(t, tasks, principal, ready)
	if started.Ready || started.Version != 3 {
		t.Fatalf("active task readiness: %#v", started)
	}
}

func TestTaskInputValidation(t *testing.T) {
	tasks, _, project, _, principal := taskService(t)
	target := createTask(t, tasks, principal, project.ID, "Target")
	for _, input := range []CreateTask{
		{Title: ""}, {Title: " \n\u2003"}, {Title: "bad\x00title"}, {Title: "bad\xfftitle"},
		{Title: "Valid", Description: "bad\x00description"}, {Title: "Valid", Description: "bad\xffdescription"},
		{Title: "Valid", DependsOn: []string{"invalid"}}, {Title: "Valid", DependsOn: []string{target.ID, strings.ToUpper(target.ID)}},
	} {
		_, err := tasks.Create(context.Background(), principal, project.ID, input)
		requireFault(t, err, "invalid_input")
	}
	for _, input := range []UpdateTask{
		{Version: 0, Title: pointer("Changed")}, {Version: -1, Title: pointer("Changed")}, {Version: target.Version},
		{Version: target.Version, Title: pointer(" ")}, {Version: target.Version, Description: pointer("bad\x00")},
		{Version: target.Version, DependsOn: pointer([]string{"invalid"})},
		{Version: target.Version, DependsOn: pointer([]string{target.ID})},
		{Version: target.Version, DependsOn: pointer([]string{target.ID, strings.ToUpper(target.ID)})},
	} {
		_, err := tasks.Update(context.Background(), principal, project.ID, target.ID, input)
		requireFault(t, err, "invalid_input")
		assertTaskUnchanged(t, tasks, principal, target)
	}
	for _, operation := range []func() error{
		func() error {
			_, err := tasks.Create(context.Background(), principal, "invalid", CreateTask{Title: "Valid"})
			return err
		},
		func() error { _, err := tasks.Get(context.Background(), principal, "invalid", target.ID); return err },
		func() error { _, err := tasks.Get(context.Background(), principal, project.ID, "invalid"); return err },
		func() error {
			_, err := tasks.List(context.Background(), principal, "invalid", TaskListRequest{})
			return err
		},
		func() error {
			_, err := tasks.Update(context.Background(), principal, "invalid", target.ID, UpdateTask{})
			return err
		},
		func() error {
			_, err := tasks.Update(context.Background(), principal, project.ID, "invalid", UpdateTask{})
			return err
		},
	} {
		requireFault(t, operation(), "invalid_input")
	}
	sentinel := errors.New("entropy unavailable")
	uuid.SetRand(entropyFailure{sentinel})
	t.Cleanup(func() { uuid.SetRand(rand.Reader) })
	_, err := tasks.Create(context.Background(), principal, project.ID, CreateTask{Title: "Valid"})
	var fault *Fault
	if !errors.Is(err, sentinel) || errors.As(err, &fault) {
		t.Fatalf("task ID entropy error must retain cause: %v", err)
	}
}

func TestTaskScopeAndDependencyReferences(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	otherProject, err := NewProjects(database).Create(context.Background(), principal, CreateProject{Name: "Other", RepoURL: "host:repo"})
	if err != nil {
		t.Fatal(err)
	}
	other := createTask(t, tasks, principal, otherProject.ID, "Other task")
	target := createTask(t, tasks, principal, project.ID, "Target")
	missingID := "00000000-0000-0000-0000-000000000000"
	for _, operation := range []func() error{
		func() error { _, err := tasks.Get(context.Background(), principal, project.ID, other.ID); return err },
		func() error { _, err := tasks.Get(context.Background(), principal, project.ID, missingID); return err },
		func() error { _, err := tasks.Get(context.Background(), principal, missingID, target.ID); return err },
		func() error {
			_, err := tasks.List(context.Background(), principal, missingID, TaskListRequest{PageRequest: PageRequest{Limit: 1}})
			return err
		},
		func() error {
			_, err := tasks.Create(context.Background(), principal, missingID, CreateTask{Title: "Missing project"})
			return err
		},
		func() error {
			_, err := tasks.Update(context.Background(), principal, missingID, target.ID, UpdateTask{Version: 1, Title: pointer("Changed")})
			return err
		},
		func() error {
			_, err := tasks.Update(context.Background(), principal, project.ID, other.ID, UpdateTask{Version: 1, Title: pointer("Changed")})
			return err
		},
	} {
		fault := requireFault(t, operation(), "not_found")
		if !errors.Is(fault, core.ErrNotFound) {
			t.Fatalf("missing cause: %#v", fault)
		}
	}
	refs := []string{other.ID, missingID}
	slices.Sort(refs)
	_, err = tasks.Create(context.Background(), principal, project.ID, CreateTask{Title: "Invalid refs", DependsOn: refs})
	fault := requireFault(t, err, "invalid_input")
	if !slices.Equal(fault.TaskIDs, refs) {
		t.Fatalf("scope-safe reference IDs: %v", fault.TaskIDs)
	}
	_, err = tasks.Update(context.Background(), principal, project.ID, target.ID, UpdateTask{Version: 1, DependsOn: &refs})
	requireFault(t, err, "invalid_input")
	assertTaskUnchanged(t, tasks, principal, target)
}

func TestTaskCyclesAndDependencyReplacement(t *testing.T) {
	tasks, _, project, _, principal := taskService(t)
	a := createTask(t, tasks, principal, project.ID, "A")
	b := createTask(t, tasks, principal, project.ID, "B", a.ID)
	c := createTask(t, tasks, principal, project.ID, "C", b.ID)
	for _, dependency := range []string{b.ID, c.ID} {
		_, err := tasks.Update(context.Background(), principal, project.ID, a.ID, UpdateTask{Version: a.Version, Title: pointer("Rejected"), DependsOn: pointer([]string{dependency})})
		fault := requireFault(t, err, "dependency_cycle")
		if !slices.Equal(fault.TaskIDs, []string{dependency}) {
			t.Fatalf("cycle details: %v", fault.TaskIDs)
		}
		assertTaskUnchanged(t, tasks, principal, a)
	}
	b = updateTask(t, tasks, principal, b, UpdateTask{DependsOn: pointer([]string{})})
	a = updateTask(t, tasks, principal, a, UpdateTask{DependsOn: pointer([]string{c.ID})})
	if len(b.DependsOn) != 0 || !slices.Equal(a.DependsOn, []string{c.ID}) {
		t.Fatalf("old edges were not replaced: A %#v, B %#v", a, b)
	}
	_, err := tasks.Update(context.Background(), principal, project.ID, b.ID, UpdateTask{Version: b.Version, DependsOn: pointer([]string{a.ID})})
	requireFault(t, err, "dependency_cycle")
	assertTaskUnchanged(t, tasks, principal, b)
}

func TestTaskLifecyclePredecessorsAndVersionOrder(t *testing.T) {
	tasks, _, project, _, principal := taskService(t)
	for _, from := range []core.TaskStatus{core.TaskProposed, core.TaskTodo, core.TaskInProgress, core.TaskDone} {
		for _, action := range []struct {
			name     string
			from, to core.TaskStatus
			apply    func(context.Context, core.Principal, string, string, int64) (core.Task, error)
		}{
			{"approve", core.TaskProposed, core.TaskTodo, tasks.Approve},
			{"claim", core.TaskTodo, core.TaskInProgress, tasks.Claim},
			{"complete", core.TaskInProgress, core.TaskDone, tasks.Complete},
		} {
			t.Run(string(from)+"_"+action.name, func(t *testing.T) {
				task := createTask(t, tasks, principal, project.ID, "Transition")
				task = updateTask(t, tasks, principal, task, UpdateTask{Description: pointer("Keep description"), Properties: propertyPatch(core.PullRequestProperty{URL: "https://github.com/owner/repo/pull/1", Title: "Keep property"})})
				if from != core.TaskProposed {
					task = approveTask(t, tasks, principal, task)
				}
				if from == core.TaskInProgress || from == core.TaskDone {
					task = claimTask(t, tasks, principal, task)
				}
				if from == core.TaskDone {
					task = completeTask(t, tasks, principal, task)
				}
				_, err := action.apply(context.Background(), principal, project.ID, task.ID, task.Version+1)
				requireFault(t, err, "version_conflict")
				assertTaskUnchanged(t, tasks, principal, task)
				after, err := action.apply(context.Background(), principal, strings.ToUpper(project.ID), strings.ToUpper(task.ID), task.Version)
				if from != action.from {
					requireFault(t, err, "invalid_transition")
					assertTaskUnchanged(t, tasks, principal, task)
					return
				}
				if err != nil || after.Status != action.to || after.Version != task.Version+1 || !after.UpdatedAt.After(task.UpdatedAt) {
					t.Fatalf("lifecycle transition: before %#v, after %#v, %v", task, after, err)
				}
				expected := task
				expected.Status, expected.Version, expected.UpdatedAt = action.to, after.Version, after.UpdatedAt
				expected.Ready = action.to == core.TaskTodo
				switch action.name {
				case "approve":
					if !reflect.DeepEqual(after.StartedAt, task.StartedAt) || !reflect.DeepEqual(after.CompletedAt, task.CompletedAt) {
						t.Fatal("approval changed execution timing")
					}
				case "claim":
					if after.StartedAt == nil || !after.StartedAt.Equal(after.UpdatedAt) || after.CompletedAt != nil {
						t.Fatal("claim did not atomically record its start and clear completion")
					}
				case "complete":
					if !reflect.DeepEqual(after.StartedAt, task.StartedAt) || after.CompletedAt == nil || !after.CompletedAt.Equal(after.UpdatedAt) ||
						after.StartedAt != nil && after.CompletedAt.Before(*after.StartedAt) {
						t.Fatal("completion did not preserve its start and atomically record its end")
					}
				}
				expected.StartedAt, expected.CompletedAt = after.StartedAt, after.CompletedAt
				if !reflect.DeepEqual(after, expected) {
					t.Fatalf("lifecycle changed unrelated fields: before %#v, after %#v", task, after)
				}
				_, err = action.apply(context.Background(), principal, project.ID, task.ID, after.Version)
				requireFault(t, err, "invalid_transition")
				assertTaskUnchanged(t, tasks, principal, after)
			})
		}
	}
}

func TestTaskLifecycleValidationAndScope(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	target := createTask(t, tasks, principal, project.ID, "Target")
	otherProject, err := NewProjects(database).Create(context.Background(), principal, CreateProject{Name: "Other", RepoURL: "host:other"})
	if err != nil {
		t.Fatal(err)
	}
	other := createTask(t, tasks, principal, otherProject.ID, "Other")
	missing := "00000000-0000-0000-0000-000000000000"
	for _, action := range []struct {
		name  string
		apply func(context.Context, core.Principal, string, string, int64) (core.Task, error)
	}{{"approve", tasks.Approve}, {"claim", tasks.Claim}, {"complete", tasks.Complete}} {
		t.Run(action.name, func(t *testing.T) {
			for _, version := range []int64{0, -1} {
				_, err := action.apply(context.Background(), principal, project.ID, target.ID, version)
				requireFault(t, err, "invalid_input")
			}
			for _, scope := range [][2]string{{"invalid", target.ID}, {project.ID, "invalid"}} {
				_, err := action.apply(context.Background(), principal, scope[0], scope[1], target.Version)
				requireFault(t, err, "invalid_input")
			}
			for _, scope := range [][2]string{{missing, target.ID}, {project.ID, missing}, {project.ID, other.ID}} {
				_, err := action.apply(context.Background(), principal, scope[0], scope[1], target.Version)
				fault := requireFault(t, err, "not_found")
				if !errors.Is(fault, core.ErrNotFound) {
					t.Fatalf("missing cause: %#v", fault)
				}
			}
			assertTaskUnchanged(t, tasks, principal, target)
			assertTaskUnchanged(t, tasks, principal, other)
		})
	}
}

func TestTaskVersionAndSemanticNoop(t *testing.T) {
	tasks, _, project, _, principal := taskService(t)
	a := createTask(t, tasks, principal, project.ID, "A")
	b := createTask(t, tasks, principal, project.ID, "B")
	target := createTask(t, tasks, principal, project.ID, "Target", a.ID, b.ID)
	for _, input := range []UpdateTask{
		{Title: pointer(target.Title)}, {Description: pointer("")},
		{DependsOn: pointer([]string{strings.ToUpper(b.ID), strings.ToUpper(a.ID)})},
	} {
		got := updateTask(t, tasks, principal, target, input)
		if !reflect.DeepEqual(got, target) {
			t.Fatalf("semantic no-op changed task: %#v", got)
		}
	}
	changed := updateTask(t, tasks, principal, target, UpdateTask{Title: pointer("Changed"), Description: pointer("New"), DependsOn: pointer([]string{})})
	if changed.Version != target.Version+1 || changed.Title != "Changed" || changed.Description != "New" || len(changed.DependsOn) != 0 || !changed.UpdatedAt.After(target.UpdatedAt) {
		t.Fatalf("multi-field update: %#v", changed)
	}
	_, err := tasks.Update(context.Background(), principal, project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer(changed.Title)})
	requireFault(t, err, "version_conflict")
	assertTaskUnchanged(t, tasks, principal, changed)
	cleared := updateTask(t, tasks, principal, changed, UpdateTask{Description: pointer("")})
	if cleared.Description != "" || cleared.Version != changed.Version+1 {
		t.Fatalf("clear description: %#v", cleared)
	}
}

func TestTaskCandidateDependencyRules(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	undone := createTask(t, tasks, principal, project.ID, "Undone")
	done := createTask(t, tasks, principal, project.ID, "Done")
	done = approveTask(t, tasks, principal, done)
	done = claimTask(t, tasks, principal, done)
	done = completeTask(t, tasks, principal, done)
	blocked := createTask(t, tasks, principal, project.ID, "Blocked", undone.ID)
	blocked = updateTask(t, tasks, principal, blocked, UpdateTask{Title: pointer("Edited proposed"), Description: pointer("Unfinished prerequisites allowed"), Properties: propertyPatch(core.PullRequestProperty{URL: "https://github.com/owner/repo/pull/1"})})
	if blocked.Status != core.TaskProposed || blocked.Ready {
		t.Fatalf("metadata changed lifecycle: %#v", blocked)
	}
	blocked = approveTask(t, tasks, principal, blocked)
	_, err := tasks.Claim(context.Background(), principal, project.ID, blocked.ID, blocked.Version)
	fault := requireFault(t, err, "dependency_unsatisfied")
	if !slices.Equal(fault.TaskIDs, []string{undone.ID}) {
		t.Fatalf("unsatisfied prerequisite IDs: %v", fault.TaskIDs)
	}
	assertTaskUnchanged(t, tasks, principal, blocked)
	for _, status := range []core.TaskStatus{core.TaskInProgress, core.TaskDone} {
		active := createTask(t, tasks, principal, project.ID, "Active", done.ID)
		active = approveTask(t, tasks, principal, active)
		active = claimTask(t, tasks, principal, active)
		if status == core.TaskDone {
			active = completeTask(t, tasks, principal, active)
		}
		_, err = tasks.Update(context.Background(), principal, project.ID, active.ID, UpdateTask{Version: active.Version, DependsOn: pointer([]string{undone.ID})})
		requireFault(t, err, "dependency_unsatisfied")
		assertTaskUnchanged(t, tasks, principal, active)
		// Store fixtures bypass policy to verify full candidate checks on metadata-only updates.
		if err := database.WriteProject(context.Background(), project.ID, func(tx *store.ProjectTx) error {
			_, err := tx.UpdateTask(context.Background(), active.ID, store.TaskWrite{Title: active.Title, Status: status, DependsOn: []string{undone.ID}})
			return err
		}); err != nil {
			t.Fatal(err)
		}
		corrupt, err := tasks.Get(context.Background(), principal, project.ID, active.ID)
		if err != nil {
			t.Fatal(err)
		}
		_, err = tasks.Update(context.Background(), principal, project.ID, active.ID, UpdateTask{Version: corrupt.Version, Title: pointer("Metadata")})
		requireFault(t, err, "dependency_unsatisfied")
		assertTaskUnchanged(t, tasks, principal, corrupt)
		if status == core.TaskInProgress {
			_, err = tasks.Complete(context.Background(), principal, project.ID, active.ID, corrupt.Version)
			requireFault(t, err, "dependency_unsatisfied")
			assertTaskUnchanged(t, tasks, principal, corrupt)
		}
	}
}

func TestTaskListKeysetsFiltersAndCursorScopes(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	ctx := context.Background()
	predecessor := createTask(t, tasks, principal, project.ID, "Predecessor")
	predecessor = approveTask(t, tasks, principal, predecessor)
	proposed := createTask(t, tasks, principal, project.ID, "Proposed")
	ready := createTask(t, tasks, principal, project.ID, "Ready")
	ready = approveTask(t, tasks, principal, ready)
	blocked := createTask(t, tasks, principal, project.ID, "Blocked", predecessor.ID)
	blocked = approveTask(t, tasks, principal, blocked)
	active := createTask(t, tasks, principal, project.ID, "Active")
	active = approveTask(t, tasks, principal, active)
	active = claimTask(t, tasks, principal, active)
	done := createTask(t, tasks, principal, project.ID, "Done")
	done = approveTask(t, tasks, principal, done)
	done = claimTask(t, tasks, principal, done)
	done = completeTask(t, tasks, principal, done)
	stamp := time.Date(2026, 2, 3, 4, 5, 6, 123456000, time.UTC)
	if _, err := database.Pool.Exec(ctx, "UPDATE tasks SET created_at = $1 WHERE project_id = $2", stamp, project.ID); err != nil {
		t.Fatal(err)
	}
	want := []string{predecessor.ID, proposed.ID, ready.ID, blocked.ID, active.ID, done.ID}
	slices.Sort(want)
	var got []string
	request := TaskListRequest{PageRequest: PageRequest{Limit: 2}}
	var firstCursor *string
	for {
		page, err := tasks.List(ctx, principal, strings.ToUpper(project.ID), request)
		if err != nil {
			t.Fatal(err)
		}
		for _, task := range page.Items {
			got = append(got, task.ID)
		}
		if page.NextCursor == nil {
			break
		}
		if firstCursor == nil {
			firstCursor = page.NextCursor
		}
		request.Cursor = page.NextCursor
	}
	if !slices.Equal(got, want) || firstCursor == nil {
		t.Fatalf("task keyset pages: %v, want %v", got, want)
	}
	for _, test := range []struct {
		status *core.TaskStatus
		ready  *bool
		ids    []string
	}{
		{nil, pointer(true), []string{predecessor.ID, ready.ID}},
		{nil, pointer(false), []string{proposed.ID, blocked.ID, active.ID, done.ID}},
		{pointer(core.TaskProposed), nil, []string{proposed.ID}},
		{pointer(core.TaskTodo), pointer(false), []string{blocked.ID}},
		{pointer(core.TaskInProgress), nil, []string{active.ID}},
		{pointer(core.TaskDone), pointer(true), []string{}},
	} {
		page, err := tasks.List(ctx, principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 100}, Status: test.status, Ready: test.ready})
		if err != nil || page.Items == nil || page.NextCursor != nil {
			t.Fatalf("filtered page: %#v, %v", page, err)
		}
		ids := make([]string, 0, len(page.Items))
		for _, task := range page.Items {
			ids = append(ids, task.ID)
		}
		slices.Sort(test.ids)
		if !slices.Equal(ids, test.ids) {
			t.Fatalf("filter results: %v, want %v", ids, test.ids)
		}
	}
	filtered, err := tasks.List(ctx, principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 1}, Status: pointer(core.TaskTodo), Ready: pointer(true)})
	if err != nil || len(filtered.Items) != 1 || filtered.NextCursor == nil {
		t.Fatalf("filtered next page: %#v, %v", filtered, err)
	}
	final, err := tasks.List(ctx, principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 1, Cursor: filtered.NextCursor}, Status: pointer(core.TaskTodo), Ready: pointer(true)})
	if err != nil || len(final.Items) != 1 || final.NextCursor != nil || final.Items[0].ID == filtered.Items[0].ID {
		t.Fatalf("filtered final page: %#v, %v", final, err)
	}
	for _, query := range []TaskListRequest{
		{PageRequest: PageRequest{Limit: 0}},
		{PageRequest: PageRequest{Limit: 10}, Status: pointer(core.TaskStatus(""))},
		{PageRequest: PageRequest{Limit: 10, Cursor: pointer("")}},
		{PageRequest: PageRequest{Limit: 10, Cursor: firstCursor}, Status: pointer(core.TaskTodo)},
		{PageRequest: PageRequest{Limit: 10, Cursor: firstCursor}, Ready: pointer(false)},
		{PageRequest: PageRequest{Limit: 10, Cursor: filtered.NextCursor}, Status: pointer(core.TaskTodo), Ready: pointer(false)},
		{PageRequest: PageRequest{Limit: 10, Cursor: filtered.NextCursor}, Status: pointer(core.TaskTodo)},
	} {
		_, err := tasks.List(ctx, principal, project.ID, query)
		requireFault(t, err, "invalid_input")
	}
	_, err = tasks.List(ctx, principal, "00000000-0000-0000-0000-000000000000", TaskListRequest{PageRequest: PageRequest{Limit: 10, Cursor: firstCursor}})
	requireFault(t, err, "invalid_input")
	_, err = NewProjects(database).List(ctx, principal, PageRequest{Limit: 10, Cursor: firstCursor})
	requireFault(t, err, "invalid_input")
	projectCursor, err := encodeProjectCursor(project)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tasks.List(ctx, principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 10, Cursor: &projectCursor}})
	requireFault(t, err, "invalid_input")
}

func TestTaskCursorEncodingFailure(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	for index := 0; index < 2; index++ {
		createTask(t, tasks, principal, project.ID, fmt.Sprint(index))
	}
	if _, err := database.Pool.Exec(context.Background(), "UPDATE tasks SET created_at = '10000-01-01'::timestamptz"); err != nil {
		t.Fatal(err)
	}
	_, err := tasks.List(context.Background(), principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 1}})
	var fault *Fault
	if err == nil || errors.As(err, &fault) || !strings.Contains(err.Error(), "encode task cursor") {
		t.Fatalf("unrepresentable cursor must fail: %v", err)
	}
}
