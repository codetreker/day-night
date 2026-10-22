package store

import (
	"context"
	"errors"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestTaskProposedMigrationPreservesExistingResourcesAndDefault(t *testing.T) {
	ctx := context.Background()
	pool := emptyPool(t)
	if err := migrate(ctx, pool, schemaMigrations[:6]); err != nil {
		t.Fatal(err)
	}
	database := &Store{Pool: pool}
	project := queryProject(t, database, 1)
	created := time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC)
	updated := created.Add(time.Hour)
	before := make([]core.Task, 0, 3)
	for index, status := range []core.TaskStatus{core.TaskTodo, core.TaskInProgress, core.TaskDone} {
		id := queryID(index + 10)
		mustQueryExec(t, database, `INSERT INTO tasks (id, project_id, title, description, status, version, created_at, updated_at)
			VALUES ($1, $2, 'Existing task', 'Existing description', $3, $4, $5, $6)`, id, project.ID, status, index+17, created, updated)
		before = append(before, snapshotTask(t, database, project.ID, id))
	}
	_, err := pool.Exec(ctx, `INSERT INTO tasks (id, project_id, title, status) VALUES ($1, $2, 'Proposed', 'proposed')`, queryID(20), project.ID)
	var constraint *pgconn.PgError
	if !errors.As(err, &constraint) || constraint.Code != "23514" {
		t.Fatalf("old schema did not reject proposed: %v", err)
	}
	if err := migrate(ctx, pool, schemaMigrations[:7]); err != nil {
		t.Fatal(err)
	}
	for _, original := range before {
		if after := snapshotTask(t, database, project.ID, original.ID); !reflect.DeepEqual(after, original) {
			t.Fatalf("migration changed existing resource: %#v versus %#v", after, original)
		}
	}
	proposed := queryTask(t, database, project.ID, 20, core.TaskProposed, before[0].ID)
	if proposed.Status != core.TaskProposed || proposed.Ready || !slices.Equal(proposed.BlockedBy, []string{before[0].ID}) {
		t.Fatalf("migrated proposed resource: %#v", proposed)
	}
	mustQueryExec(t, database, `INSERT INTO tasks (id, project_id, title) VALUES ($1, $2, 'Default')`, queryID(21), project.ID)
	if task := snapshotTask(t, database, project.ID, queryID(21)); task.Status != core.TaskTodo || !task.Ready {
		t.Fatalf("migration changed database creation default: %#v", task)
	}
	var applied time.Time
	if err := pool.QueryRow(ctx, "SELECT applied_at FROM schema_migrations WHERE version=7").Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, pool, schemaMigrations[:7]); err != nil {
		t.Fatal(err)
	}
	var after time.Time
	if err := pool.QueryRow(ctx, "SELECT applied_at FROM schema_migrations WHERE version=7").Scan(&after); err != nil || !after.Equal(applied) || !reflect.DeepEqual(snapshotTask(t, database, project.ID, proposed.ID), proposed) {
		t.Fatalf("repeated migration changed ledger/resource: %v, %v", after, err)
	}
}

func TestTaskProposedGetPaginationAndReadiness(t *testing.T) {
	database := isolatedStore(t)
	ctx := context.Background()
	project := queryProject(t, database, 1)
	pending := queryTask(t, database, project.ID, 10, core.TaskTodo)
	done := queryTask(t, database, project.ID, 11, core.TaskDone)
	unblocked := queryTask(t, database, project.ID, 12, core.TaskProposed, done.ID)
	blocked := queryTask(t, database, project.ID, 13, core.TaskProposed, pending.ID)
	dependent := queryTask(t, database, project.ID, 14, core.TaskTodo, unblocked.ID)
	if err := database.ReadSnapshot(ctx, func(snapshot *Snapshot) error {
		for _, task := range []core.Task{unblocked, blocked} {
			read, err := snapshot.Task(ctx, project.ID, task.ID)
			if err != nil || !reflect.DeepEqual(read, task) || read.Ready {
				t.Fatalf("proposed GET projection: %#v, %v", read, err)
			}
		}
		if len(unblocked.BlockedBy) != 0 || !slices.Equal(blocked.BlockedBy, []string{pending.ID}) || !slices.Equal(dependent.BlockedBy, []string{unblocked.ID}) || dependent.Ready {
			t.Fatalf("proposed dependency projection: %#v, %#v, %#v", unblocked, blocked, dependent)
		}
		page := Page{Limit: 2}
		var listed []string
		for {
			result, err := snapshot.Tasks(ctx, project.ID, TaskQuery{Page: page})
			if err != nil {
				return err
			}
			for _, task := range result.Items {
				listed = append(listed, task.ID)
			}
			if !result.HasMore {
				break
			}
			last := result.Items[len(result.Items)-1]
			page.After = &Position{CreatedAt: last.CreatedAt, ID: last.ID}
		}
		if !slices.Equal(listed, []string{pending.ID, done.ID, unblocked.ID, blocked.ID, dependent.ID}) {
			t.Fatalf("paginated inventory omitted proposed: %#v", listed)
		}
		ready := true
		result, err := snapshot.Tasks(ctx, project.ID, TaskQuery{Page: Page{Limit: 10}, Ready: &ready})
		if err != nil || len(result.Items) != 1 || result.Items[0].ID != pending.ID {
			t.Fatalf("proposed task appeared as ready: %#v, %v", result, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestTaskProposedDefaultMigrationPreservesExistingResources(t *testing.T) {
	ctx := context.Background()
	pool := emptyPool(t)
	if err := migrate(ctx, pool, schemaMigrations[:7]); err != nil {
		t.Fatal(err)
	}
	database := &Store{Pool: pool}
	project := queryProject(t, database, 1)
	stamp := time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC)
	var before []core.Task
	for index, status := range []core.TaskStatus{core.TaskProposed, core.TaskTodo, core.TaskInProgress, core.TaskDone} {
		id := queryID(index + 10)
		mustQueryExec(t, database, `INSERT INTO tasks (id, project_id, title, description, status, version, created_at, updated_at)
			VALUES ($1, $2, 'Existing task', 'Existing description', $3, $4, $5, $6)`, id, project.ID, status, index+17, stamp, stamp.Add(time.Hour))
		before = append(before, snapshotTask(t, database, project.ID, id))
	}
	if err := migrate(ctx, pool, schemaMigrations); err != nil {
		t.Fatal(err)
	}
	for _, original := range before {
		if after := snapshotTask(t, database, project.ID, original.ID); !reflect.DeepEqual(after, original) {
			t.Fatalf("default migration changed existing resource: %#v versus %#v", after, original)
		}
	}
	mustQueryExec(t, database, `INSERT INTO tasks (id, project_id, title) VALUES ($1, $2, 'Default')`, queryID(21), project.ID)
	created := snapshotTask(t, database, project.ID, queryID(21))
	if created.Status != core.TaskProposed || created.Ready || created.Version != 1 || !created.CreatedAt.Equal(created.UpdatedAt) {
		t.Fatalf("database default did not create proposed task: %#v", created)
	}
	var applied time.Time
	if err := pool.QueryRow(ctx, "SELECT applied_at FROM schema_migrations WHERE version=8").Scan(&applied); err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, pool, schemaMigrations); err != nil {
		t.Fatal(err)
	}
	var after time.Time
	if err := pool.QueryRow(ctx, "SELECT applied_at FROM schema_migrations WHERE version=8").Scan(&after); err != nil || !after.Equal(applied) || !reflect.DeepEqual(snapshotTask(t, database, project.ID, created.ID), created) {
		t.Fatalf("repeated default migration changed ledger/resource: %v, %v", after, err)
	}
}
