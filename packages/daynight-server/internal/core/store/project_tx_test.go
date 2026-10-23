package store

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/jackc/pgx/v5"
)

func waitForQueryLock(t *testing.T, s *Store, prefix string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := s.Pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE $1)`, prefix+"%").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("query never reached a database lock wait")
		case <-ticker.C:
		}
	}
}

func receiveQueryResult(t *testing.T, ctx context.Context, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		t.Fatal(ctx.Err())
		return ctx.Err()
	}
}

func TestProjectTransactionsSerializeAndReadFreshAfterLock(t *testing.T) {
	s := isolatedStore(t)
	first, second := queryProject(t, s, 1), queryProject(t, s, 2)
	task := queryTask(t, s, first.ID, 11, core.TaskTodo)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result := make(chan error, 1)
	var firstUpdate, secondUpdate core.Task
	if err := s.WriteProject(ctx, first.ID, func(tx *ProjectTx) error {
		var isolation string
		if err := tx.tx.QueryRow(ctx, "SHOW transaction_isolation").Scan(&isolation); err != nil || isolation != "read committed" {
			t.Fatalf("write isolation: %s, %v", isolation, err)
		}
		go func() {
			result <- s.WriteProject(ctx, first.ID, func(waiter *ProjectTx) error {
				fresh, err := waiter.Task(ctx, task.ID)
				if err != nil {
					return err
				}
				if fresh.Status != core.TaskDone || fresh.Version != 2 {
					return errors.New("lock waiter read a snapshot predating the preceding commit")
				}
				secondUpdate, err = waiter.UpdateTask(ctx, task.ID, TaskWrite{Title: "Second", Status: core.TaskDone})
				return err
			})
		}()
		waitForQueryLock(t, s, "SELECT id::text FROM projects WHERE")
		independent, finish := context.WithTimeout(ctx, 2*time.Second)
		defer finish()
		if err := s.WriteProject(independent, second.ID, func(other *ProjectTx) error {
			_, err := other.CreateTask(independent, queryID(12), TaskWrite{Title: "Independent", Status: core.TaskTodo})
			return err
		}); err != nil {
			t.Fatalf("unrelated project was blocked: %v", err)
		}
		var err error
		firstUpdate, err = tx.UpdateTask(ctx, task.ID, TaskWrite{Title: "First", Status: core.TaskDone})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := receiveQueryResult(t, ctx, result); err != nil {
		t.Fatal(err)
	}
	if secondUpdate.Version != 3 || !secondUpdate.UpdatedAt.After(firstUpdate.UpdatedAt) {
		t.Fatalf("lock waiter timestamp/version regressed: first %#v, second %#v", firstUpdate, secondUpdate)
	}
}

func TestProjectTransactionsCancelActualRowLockWithoutLateWrite(t *testing.T) {
	s := isolatedStore(t)
	project := queryProject(t, s, 1)
	before := queryTask(t, s, project.ID, 11, core.TaskTodo)
	ctx, finish := context.WithTimeout(context.Background(), 10*time.Second)
	defer finish()
	var invoked atomic.Bool
	if err := s.WriteProject(ctx, project.ID, func(*ProjectTx) error {
		waiting, cancel := context.WithCancel(ctx)
		defer cancel()
		result := make(chan error, 1)
		go func() {
			result <- s.WriteProject(waiting, project.ID, func(tx *ProjectTx) error {
				invoked.Store(true)
				_, err := tx.UpdateTask(waiting, before.ID, TaskWrite{Title: "Late", Status: core.TaskDone})
				return err
			})
		}()
		waitForQueryLock(t, s, "SELECT id::text FROM projects WHERE")
		cancel()
		if err := receiveQueryResult(t, ctx, result); !errors.Is(err, context.Canceled) {
			t.Fatalf("row-lock cancellation cause: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if invoked.Load() {
		t.Fatal("canceled lock wait invoked mutation callback")
	}
	after := snapshotTask(t, s, project.ID, before.ID)
	if after.Title != before.Title || after.Version != before.Version || !after.UpdatedAt.Equal(before.UpdatedAt) {
		t.Fatalf("canceled row-lock wait wrote late: %#v", after)
	}
	if err := s.WriteProject(ctx, project.ID, func(tx *ProjectTx) error {
		_, err := tx.Task(ctx, before.ID)
		return err
	}); err != nil {
		t.Fatalf("lock was not reusable: %v", err)
	}
}

func TestProjectTransactionsCancelActualQueryWait(t *testing.T) {
	s := isolatedStore(t)
	project := queryProject(t, s, 1)
	task := queryTask(t, s, project.ID, 11, core.TaskTodo)
	ctx, finish := context.WithTimeout(context.Background(), 10*time.Second)
	defer finish()
	blocker, err := s.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = blocker.Rollback(context.Background()) }()
	if _, err := blocker.Exec(ctx, "LOCK TABLE tasks IN ACCESS EXCLUSIVE MODE"); err != nil {
		t.Fatal(err)
	}
	waiting, cancel := context.WithCancel(ctx)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		result <- s.ReadSnapshot(waiting, func(snapshot *Snapshot) error {
			_, err := snapshot.Task(waiting, project.ID, task.ID)
			return err
		})
	}()
	waitForQueryLock(t, s, "SELECT t.id::text")
	cancel()
	if err := receiveQueryResult(t, ctx, result); !errors.Is(err, context.Canceled) {
		t.Fatalf("query cancellation cause: %v", err)
	}
	if err := blocker.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if after := snapshotTask(t, s, project.ID, task.ID); after.Version != task.Version {
		t.Fatalf("canceled query changed task: %#v", after)
	}
	assertMigrationPoolReusable(t, s.Pool)
}

func TestQueriesFailuresPreserveCauses(t *testing.T) {
	s := isolatedStore(t)
	ctx := context.Background()
	project := queryProject(t, s, 1)
	task := queryTask(t, s, project.ID, 11, core.TaskTodo)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	for _, operation := range []func() error{
		func() error { _, err := s.CreateProject(canceled, queryID(99), "Canceled", "repo"); return err },
		func() error {
			return s.ReadSnapshot(canceled, func(*Snapshot) error { t.Fatal("canceled snapshot began"); return nil })
		},
		func() error {
			return s.WriteProject(canceled, project.ID, func(*ProjectTx) error { t.Fatal("canceled writer began"); return nil })
		},
	} {
		if err := operation(); !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled begin cause: %v", err)
		}
	}
	var expiredSnapshot *Snapshot
	if err := s.ReadSnapshot(ctx, func(snapshot *Snapshot) error { expiredSnapshot = snapshot; return nil }); err != nil {
		t.Fatal(err)
	}
	var expiredProject *ProjectTx
	if err := s.WriteProject(ctx, project.ID, func(tx *ProjectTx) error { expiredProject = tx; return nil }); err != nil {
		t.Fatal(err)
	}
	for _, operation := range []func() error{
		func() error { _, err := expiredSnapshot.Projects(ctx, Page{Limit: 10}); return err },
		func() error { _, err := expiredSnapshot.ObservedAt(ctx); return err },
		func() error {
			_, err := expiredSnapshot.Tasks(ctx, project.ID, TaskQuery{Page: Page{Limit: 10}})
			return err
		},
		func() error { _, err := expiredProject.TasksByID(ctx, []string{task.ID}); return err },
		func() error {
			_, err := expiredProject.Reachable(ctx, task.ID, queryID(99), DependencyReplacement{task.ID, nil})
			return err
		},
	} {
		if err := operation(); !errors.Is(err, pgx.ErrTxClosed) {
			t.Fatalf("completed transaction cause was lost: %v", err)
		}
	}
	for _, test := range []struct {
		name string
		call func(*ProjectTx) error
	}{
		{"invalid task metadata", func(tx *ProjectTx) error {
			_, err := tx.CreateTask(ctx, queryID(12), TaskWrite{Title: "", Status: core.TaskTodo})
			return err
		}},
		{"invalid update", func(tx *ProjectTx) error {
			_, err := tx.UpdateTask(ctx, task.ID, TaskWrite{Title: "Changed", Status: "unknown"})
			return err
		}},
		{"invalid edge rolls back creation", func(tx *ProjectTx) error {
			_, err := tx.CreateTask(ctx, queryID(12), TaskWrite{Title: "New", Status: core.TaskTodo, DependsOn: []string{queryID(12)}})
			return err
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := s.WriteProject(ctx, project.ID, test.call); err == nil {
				t.Fatal("invalid database write succeeded")
			}
			if got := snapshotTask(t, s, project.ID, task.ID); got.Title != task.Title || got.Version != task.Version {
				t.Fatalf("failed update changed task: %#v", got)
			}
		})
	}
	if err := s.ReadSnapshot(ctx, func(snapshot *Snapshot) error {
		_, err := snapshot.Task(ctx, project.ID, queryID(12))
		return err
	}); !errors.Is(err, core.ErrNotFound) {
		t.Fatalf("failed create was persisted: %v", err)
	}

	dependency := queryTask(t, s, project.ID, 13, core.TaskDone)
	queryTask(t, s, project.ID, 14, core.TaskTodo, dependency.ID)
	mustQueryExec(t, s, `CREATE FUNCTION reject_edge_delete() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'private SQL diagnostic'; END $$;
		CREATE TRIGGER reject_edge_delete BEFORE DELETE ON task_dependencies FOR EACH ROW EXECUTE FUNCTION reject_edge_delete()`)
	err := s.WriteProject(ctx, project.ID, func(tx *ProjectTx) error {
		_, err := tx.UpdateTask(ctx, queryID(14), TaskWrite{Title: "Changed", Status: core.TaskTodo})
		return err
	})
	if err == nil || strings.Contains(err.Error(), "private SQL") {
		t.Fatalf("replace dependency error: %v", err)
	}
}
