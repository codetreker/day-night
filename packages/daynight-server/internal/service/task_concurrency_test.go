package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
)

type taskResult struct {
	task core.Task
	err  error
}

func waitForTaskWriters(t *testing.T, ctx context.Context, database *store.Store, count int) {
	t.Helper()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting int
		err := database.Pool.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE application_name = current_setting('application_name') AND wait_event_type = 'Lock'
			AND query LIKE 'SELECT id::text FROM projects WHERE id = % FOR UPDATE'`).Scan(&waiting)
		if err != nil {
			t.Fatal(err)
		}
		if waiting >= count {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("%d task writers never reached their own project lock: %v", count, ctx.Err())
		case <-ticker.C:
		}
	}
}

func receiveTaskResult(t *testing.T, ctx context.Context, result <-chan taskResult) taskResult {
	t.Helper()
	select {
	case result := <-result:
		return result
	case <-ctx.Done():
		t.Fatal(ctx.Err())
		return taskResult{}
	}
}

func competeTaskWrites(t *testing.T, database *store.Store, projectID string, operations ...func(context.Context) (core.Task, error)) []taskResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result := make(chan taskResult, len(operations))
	if err := database.WriteProject(ctx, projectID, func(*store.ProjectTx) error {
		for _, operation := range operations {
			go func() {
				task, err := operation(ctx)
				result <- taskResult{task: task, err: err}
			}()
		}
		waitForTaskWriters(t, ctx, database, len(operations))
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	results := make([]taskResult, 0, len(operations))
	for range operations {
		results = append(results, receiveTaskResult(t, ctx, result))
	}
	return results
}

func assertOneTaskWinner(t *testing.T, results []taskResult, code string) {
	t.Helper()
	success, refused := 0, 0
	for _, result := range results {
		if result.err == nil {
			success++
		} else {
			requireFault(t, result.err, code)
			refused++
		}
	}
	if success != 1 || refused != 1 {
		t.Fatalf("expected one winning write and one %s refusal, got %#v", code, results)
	}
}

func TestConcurrentReverseDependenciesCannotCreateCycle(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	a := createTask(t, tasks, principal, project.ID, "A")
	b := createTask(t, tasks, principal, project.ID, "B")
	results := competeTaskWrites(t, database, project.ID,
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, principal, project.ID, a.ID, UpdateTask{Version: a.Version, DependsOn: pointer([]string{b.ID})})
		},
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, principal, project.ID, b.ID, UpdateTask{Version: b.Version, DependsOn: pointer([]string{a.ID})})
		})
	assertOneTaskWinner(t, results, "dependency_cycle")
	afterA, err := tasks.Get(context.Background(), principal, project.ID, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	afterB, err := tasks.Get(context.Background(), principal, project.ID, b.ID)
	if err != nil || len(afterA.DependsOn)+len(afterB.DependsOn) != 1 || afterA.Version+afterB.Version != 3 {
		t.Fatalf("reverse edges persisted an invalid graph: A %#v, B %#v, %v", afterA, afterB, err)
	}
}

func TestConcurrentDependencyReplacementAndClaimPreserveStateInvariant(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	predecessor := createTask(t, tasks, principal, project.ID, "Unfinished prerequisite")
	dependent := createTask(t, tasks, principal, project.ID, "Dependent")
	dependent = approveTask(t, tasks, principal, dependent)
	results := competeTaskWrites(t, database, project.ID,
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, principal, project.ID, dependent.ID, UpdateTask{Version: dependent.Version, DependsOn: pointer([]string{predecessor.ID})})
		},
		func(ctx context.Context) (core.Task, error) {
			return tasks.Claim(ctx, principal, project.ID, dependent.ID, dependent.Version)
		})
	assertOneTaskWinner(t, results, "version_conflict")
	after, err := tasks.Get(context.Background(), principal, project.ID, dependent.ID)
	if err != nil || after.Version != dependent.Version+1 {
		t.Fatalf("concurrent dependency/claim result: %#v, %v", after, err)
	}
	if after.Status == core.TaskInProgress {
		if len(after.DependsOn) != 0 || len(after.BlockedBy) != 0 {
			t.Fatalf("claimed task acquired unfinished prerequisite: %#v", after)
		}
	} else if after.Status != core.TaskTodo || len(after.DependsOn) != 1 || after.DependsOn[0] != predecessor.ID || after.Ready {
		t.Fatalf("dependency replacement lost approved blocked state: %#v", after)
	}
	assertTaskUnchanged(t, tasks, principal, predecessor)
}

func TestConcurrentLifecycleSameVersionOnlyChangesOnce(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	for _, action := range []struct {
		name  string
		to    core.TaskStatus
		apply func(context.Context, core.Principal, string, string, int64) (core.Task, error)
	}{
		{"approve", core.TaskTodo, tasks.Approve},
		{"unapprove", core.TaskProposed, tasks.Unapprove},
		{"claim", core.TaskInProgress, tasks.Claim},
		{"complete", core.TaskDone, tasks.Complete},
	} {
		t.Run(action.name, func(t *testing.T) {
			target := createTask(t, tasks, principal, project.ID, "Concurrent lifecycle")
			if action.name != "approve" {
				target = approveTask(t, tasks, principal, target)
			}
			if action.name == "complete" {
				target = claimTask(t, tasks, principal, target)
			}
			write := func(ctx context.Context) (core.Task, error) {
				return action.apply(ctx, principal, project.ID, target.ID, target.Version)
			}
			results := competeTaskWrites(t, database, project.ID, write, write)
			assertOneTaskWinner(t, results, "version_conflict")
			after, err := tasks.Get(context.Background(), principal, project.ID, target.ID)
			if err != nil || after.Version != target.Version+1 || after.Status != action.to || !after.UpdatedAt.After(target.UpdatedAt) {
				t.Fatalf("lifecycle competition: before %#v, after %#v, %v", target, after, err)
			}
		})
	}
}

func TestConcurrentSameVersionUpdatesOnlyChangeOnce(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	target := createTask(t, tasks, principal, project.ID, "Original")
	results := competeTaskWrites(t, database, project.ID,
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, principal, project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer("First")})
		},
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, principal, project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer("Second")})
		})
	assertOneTaskWinner(t, results, "version_conflict")
	after, err := tasks.Get(context.Background(), principal, project.ID, target.ID)
	if err != nil || after.Version != target.Version+1 || (after.Title != "First" && after.Title != "Second") {
		t.Fatalf("version competition: %#v, %v", after, err)
	}
}

func TestConcurrentUnapproveAndClaimHaveOneWinner(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	target := approveTask(t, tasks, principal, createTask(t, tasks, principal, project.ID, "Competing admission"))
	results := competeTaskWrites(t, database, project.ID,
		func(ctx context.Context) (core.Task, error) {
			return tasks.Unapprove(ctx, principal, project.ID, target.ID, target.Version)
		},
		func(ctx context.Context) (core.Task, error) {
			return tasks.Claim(ctx, principal, project.ID, target.ID, target.Version)
		})
	assertOneTaskWinner(t, results, "version_conflict")
	after, err := tasks.Get(context.Background(), principal, project.ID, target.ID)
	if err != nil || after.Version != target.Version+1 || after.Ready ||
		(after.Status != core.TaskProposed && after.Status != core.TaskInProgress) {
		t.Fatalf("withdrawal/claim competition: before %#v, after %#v, %v", target, after, err)
	}
	if after.Status == core.TaskProposed && (after.StartedAt != nil || after.CompletedAt != nil) {
		t.Fatal("withdrawal winner recorded execution timing")
	}
	if after.Status == core.TaskInProgress && (after.StartedAt == nil || !after.StartedAt.Equal(after.UpdatedAt) || after.CompletedAt != nil) {
		t.Fatal("claim winner did not record its execution start")
	}
}

func TestTaskLockWaitCancellationAndIndependentProjectProgress(t *testing.T) {
	tasks, database, project, _, principal := taskService(t)
	target := createTask(t, tasks, principal, project.ID, "Target")
	otherProject, err := NewProjects(database).Create(context.Background(), principal, CreateProject{Name: "Other", RepoURL: "host:repo"})
	if err != nil {
		t.Fatal(err)
	}
	other := createTask(t, tasks, principal, otherProject.ID, "Other task")
	ctx, finish := context.WithTimeout(context.Background(), 10*time.Second)
	defer finish()
	result := make(chan taskResult, 1)
	if err := database.WriteProject(ctx, project.ID, func(*store.ProjectTx) error {
		waiting, cancel := context.WithCancel(ctx)
		defer cancel()
		go func() {
			task, err := tasks.Update(waiting, principal, project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer("Late write")})
			result <- taskResult{task: task, err: err}
		}()
		waitForTaskWriters(t, ctx, database, 1)
		independent, done := context.WithTimeout(ctx, 2*time.Second)
		defer done()
		updated, err := tasks.Update(independent, principal, otherProject.ID, other.ID, UpdateTask{Version: other.Version, Title: pointer("Independent")})
		if err != nil || updated.Title != "Independent" {
			t.Fatalf("unrelated project write was blocked: %#v, %v", updated, err)
		}
		cancel()
		failed := receiveTaskResult(t, ctx, result)
		assertOperational(t, failed.err)
		if !errors.Is(failed.err, context.Canceled) || strings.Contains(failed.err.Error(), "Late write") {
			t.Fatalf("canceled row-lock wait lost cause or exposed metadata: %v", failed.err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	assertTaskUnchanged(t, tasks, principal, target)
	after := updateTask(t, tasks, principal, target, UpdateTask{Title: pointer("Reused lock")})
	if after.Version != target.Version+1 || after.Title != "Reused lock" {
		t.Fatalf("lock could not be reused after cancellation: %#v", after)
	}
}
