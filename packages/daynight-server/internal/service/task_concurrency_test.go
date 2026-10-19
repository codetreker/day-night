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
	tasks, database, project, _ := taskService(t)
	a := createTask(t, tasks, project.ID, "A")
	b := createTask(t, tasks, project.ID, "B")
	results := competeTaskWrites(t, database, project.ID,
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, project.ID, a.ID, UpdateTask{Version: a.Version, DependsOn: pointer([]string{b.ID})})
		},
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, project.ID, b.ID, UpdateTask{Version: b.Version, DependsOn: pointer([]string{a.ID})})
		})
	assertOneTaskWinner(t, results, "dependency_cycle")
	afterA, err := tasks.Get(context.Background(), project.ID, a.ID)
	if err != nil {
		t.Fatal(err)
	}
	afterB, err := tasks.Get(context.Background(), project.ID, b.ID)
	if err != nil || len(afterA.DependsOn)+len(afterB.DependsOn) != 1 || afterA.Version+afterB.Version != 3 {
		t.Fatalf("reverse edges persisted an invalid graph: A %#v, B %#v, %v", afterA, afterB, err)
	}
}

func TestConcurrentReopenAndStartPreserveStateInvariant(t *testing.T) {
	tasks, database, project, _ := taskService(t)
	predecessor := createTask(t, tasks, project.ID, "Predecessor")
	predecessor = updateTask(t, tasks, predecessor, UpdateTask{Status: pointer(core.TaskDone)})
	dependent := createTask(t, tasks, project.ID, "Dependent", predecessor.ID)
	results := competeTaskWrites(t, database, project.ID,
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, project.ID, predecessor.ID, UpdateTask{Version: predecessor.Version, Status: pointer(core.TaskTodo)})
		},
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, project.ID, dependent.ID, UpdateTask{Version: dependent.Version, Status: pointer(core.TaskInProgress)})
		})
	assertOneTaskWinner(t, results, "dependency_unsatisfied")
	afterPredecessor, err := tasks.Get(context.Background(), project.ID, predecessor.ID)
	if err != nil {
		t.Fatal(err)
	}
	afterDependent, err := tasks.Get(context.Background(), project.ID, dependent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if afterDependent.Status == core.TaskInProgress && afterPredecessor.Status != core.TaskDone {
		t.Fatalf("started task has unfinished prerequisite: %#v / %#v", afterPredecessor, afterDependent)
	}
	if afterPredecessor.Status == core.TaskTodo && (afterDependent.Status != core.TaskTodo || afterDependent.Ready) {
		t.Fatalf("reopened prerequisite has invalid downstream state: %#v / %#v", afterPredecessor, afterDependent)
	}
}

func TestConcurrentSameVersionUpdatesOnlyChangeOnce(t *testing.T) {
	tasks, database, project, _ := taskService(t)
	target := createTask(t, tasks, project.ID, "Original")
	results := competeTaskWrites(t, database, project.ID,
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer("First")})
		},
		func(ctx context.Context) (core.Task, error) {
			return tasks.Update(ctx, project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer("Second")})
		})
	assertOneTaskWinner(t, results, "version_conflict")
	after, err := tasks.Get(context.Background(), project.ID, target.ID)
	if err != nil || after.Version != target.Version+1 || (after.Title != "First" && after.Title != "Second") {
		t.Fatalf("version competition: %#v, %v", after, err)
	}
}

func TestTaskLockWaitCancellationAndIndependentProjectProgress(t *testing.T) {
	tasks, database, project, _ := taskService(t)
	target := createTask(t, tasks, project.ID, "Target")
	otherProject, err := NewProjects(database).Create(context.Background(), CreateProject{Name: "Other", RepoURL: "host:repo"})
	if err != nil {
		t.Fatal(err)
	}
	other := createTask(t, tasks, otherProject.ID, "Other task")
	ctx, finish := context.WithTimeout(context.Background(), 10*time.Second)
	defer finish()
	result := make(chan taskResult, 1)
	if err := database.WriteProject(ctx, project.ID, func(*store.ProjectTx) error {
		waiting, cancel := context.WithCancel(ctx)
		defer cancel()
		go func() {
			task, err := tasks.Update(waiting, project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer("Late write")})
			result <- taskResult{task: task, err: err}
		}()
		waitForTaskWriters(t, ctx, database, 1)
		independent, done := context.WithTimeout(ctx, 2*time.Second)
		defer done()
		updated, err := tasks.Update(independent, otherProject.ID, other.ID, UpdateTask{Version: other.Version, Title: pointer("Independent")})
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
	assertTaskUnchanged(t, tasks, target)
	after := updateTask(t, tasks, target, UpdateTask{Title: pointer("Reused lock")})
	if after.Version != target.Version+1 || after.Title != "Reused lock" {
		t.Fatalf("lock could not be reused after cancellation: %#v", after)
	}
}
