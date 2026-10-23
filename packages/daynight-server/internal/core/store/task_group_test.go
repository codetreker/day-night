package store

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestTaskGroupMemberLookupIsProjectScopedAndExcludesAnchor(t *testing.T) {
	database := isolatedStore(t)
	ctx := context.Background()
	project, foreign := queryProject(t, database, 1), queryProject(t, database, 2)
	anchor := queryTask(t, database, project.ID, 10, core.TaskProposed)
	other := queryTask(t, database, project.ID, 11, core.TaskProposed)
	foreignAnchor := queryTask(t, database, foreign.ID, 20, core.TaskProposed)
	if err := database.WriteProject(ctx, foreign.ID, func(tx *ProjectTx) error {
		_, err := tx.CreateTask(ctx, queryID(21), TaskWrite{GroupID: foreignAnchor.ID, Title: "Foreign member", Status: core.TaskProposed})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := database.WriteProject(ctx, project.ID, func(tx *ProjectTx) error {
		for _, group := range []string{anchor.ID, other.ID, foreignAnchor.ID, queryID(999)} {
			exists, err := tx.HasOtherGroupMembers(ctx, group)
			if err != nil || exists {
				t.Fatalf("anchor-only, unrelated or foreign group counted as a member: %s %v, %v", group, exists, err)
			}
		}
		if _, err := tx.CreateTask(ctx, queryID(12), TaskWrite{GroupID: anchor.ID, Title: "Disconnected member", Status: core.TaskProposed}); err != nil {
			return err
		}
		exists, err := tx.HasOtherGroupMembers(ctx, anchor.ID)
		if err != nil || !exists {
			t.Fatalf("explicit disconnected member was not counted: %v, %v", exists, err)
		}
		exists, err = tx.HasOtherGroupMembers(ctx, other.ID)
		if err != nil || exists {
			t.Fatalf("another group's member affected the anchor: %v, %v", exists, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestTaskGroupMemberLookupPreservesOperationalCauses(t *testing.T) {
	for _, canceled := range []bool{true, false} {
		name := "database failure"
		if canceled {
			name = "cancellation"
		}
		t.Run(name, func(t *testing.T) {
			database := isolatedStore(t)
			ctx := context.Background()
			project := queryProject(t, database, 1)
			anchor := queryTask(t, database, project.ID, 10, core.TaskProposed)
			if !canceled {
				mustQueryExec(t, database, "DROP TABLE tasks")
			}
			var lookupError error
			err := database.WriteProject(ctx, project.ID, func(tx *ProjectTx) error {
				queryContext, cancel := context.WithCancel(ctx)
				defer cancel()
				if canceled {
					cancel()
				}
				_, lookupError = tx.HasOtherGroupMembers(queryContext, anchor.ID)
				return lookupError
			})
			var failure *Error
			if !errors.As(lookupError, &failure) || failure.Phase != "read group members" || !errors.Is(err, lookupError) {
				t.Fatalf("lookup or transaction lost its original operational error: lookup=%v transaction=%v", lookupError, err)
			}
			if canceled {
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("member lookup lost cancellation: %v", err)
				}
			} else {
				var cause *pgconn.PgError
				if !errors.As(err, &cause) || cause.Code != "42P01" {
					t.Fatalf("member lookup lost the driver failure: %v", err)
				}
			}
		})
	}
}

func TestTaskGroupMigrationAssignsNewestAncestorAndPreservesResources(t *testing.T) {
	ctx := context.Background()
	pool := emptyPool(t)
	if err := migrate(ctx, pool, schemaMigrations[:8]); err != nil {
		t.Fatal(err)
	}
	database := &Store{Pool: pool}
	project, other := queryProject(t, database, 1), queryProject(t, database, 2)
	stamp := time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC)
	before := make(map[string]string)
	for _, row := range []struct {
		id, project string
		created     time.Time
	}{
		{queryID(10), project.ID, stamp},
		{queryID(11), project.ID, stamp.Add(time.Hour)},
		{queryID(12), project.ID, stamp.Add(time.Hour)},
		{queryID(13), project.ID, stamp.Add(2 * time.Hour)},
		{queryID(14), project.ID, stamp.Add(3 * time.Hour)},
		{queryID(15), project.ID, stamp.Add(4 * time.Hour)},
		{queryID(16), project.ID, stamp.Add(5 * time.Hour)},
		{queryID(17), project.ID, stamp.Add(6 * time.Hour)},
		{queryID(20), other.ID, stamp.Add(7 * time.Hour)},
	} {
		mustQueryExec(t, database, `INSERT INTO tasks(id,project_id,title,description,status,version,created_at,updated_at,properties)
			VALUES ($1,$2,'Preserved title','Preserved description','todo',17,$3,$4,'{"pullRequests":[{"url":"https://example.com/pr/1","title":"Existing PR"}]}')`,
			row.id, row.project, row.created, stamp.Add(8*time.Hour))
		before[row.id] = historicalTaskState(t, database, row.id)
	}
	for _, edge := range [][2]int{{13, 10}, {13, 11}, {13, 12}, {14, 13}, {15, 10}, {16, 10}} {
		mustQueryExec(t, database, `INSERT INTO task_dependencies(project_id,task_id,depends_on_task_id) VALUES ($1,$2,$3)`, project.ID, queryID(edge[0]), queryID(edge[1]))
	}
	var dependencies string
	if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(d) ORDER BY task_id, depends_on_task_id)::text FROM task_dependencies d`).Scan(&dependencies); err != nil {
		t.Fatal(err)
	}
	if err := migrate(ctx, pool, schemaMigrations); err != nil {
		t.Fatal(err)
	}
	expected := map[int]int{10: 10, 11: 11, 12: 12, 13: 12, 14: 12, 15: 10, 16: 10, 17: 17, 20: 20}
	for number, group := range expected {
		projectID := project.ID
		if number == 20 {
			projectID = other.ID
		}
		task := snapshotTask(t, database, projectID, queryID(number))
		if task.GroupID != queryID(group) || historicalTaskState(t, database, task.ID) != before[task.ID] {
			t.Fatalf("migration assigned the wrong group or changed metadata: %#v", task)
		}
	}
	var afterDependencies string
	if err := pool.QueryRow(ctx, `SELECT jsonb_agg(to_jsonb(d) ORDER BY task_id, depends_on_task_id)::text FROM task_dependencies d`).Scan(&afterDependencies); err != nil || afterDependencies != dependencies {
		t.Fatalf("group migration changed dependencies: %s, %v", afterDependencies, err)
	}
	var indexed bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='tasks_project_group')`).Scan(&indexed); err != nil || !indexed {
		t.Fatalf("group lookup index missing: %v, %v", indexed, err)
	}
	_, err := pool.Exec(ctx, `INSERT INTO tasks(id,project_id,title) VALUES ($1,$2,'Missing group')`, queryID(30), project.ID)
	var constraint *pgconn.PgError
	if !errors.As(err, &constraint) || constraint.Code != "23502" {
		t.Fatalf("task storage accepted missing group: %v", err)
	}
	var applied time.Time
	if err := pool.QueryRow(ctx, "SELECT applied_at FROM schema_migrations WHERE version=9").Scan(&applied); err != nil {
		t.Fatal(err)
	}
	original := snapshotTask(t, database, project.ID, queryID(13))
	if err := migrate(ctx, pool, schemaMigrations); err != nil {
		t.Fatal(err)
	}
	var reapplied time.Time
	if err := pool.QueryRow(ctx, "SELECT applied_at FROM schema_migrations WHERE version=9").Scan(&reapplied); err != nil || !reapplied.Equal(applied) || !reflect.DeepEqual(snapshotTask(t, database, project.ID, original.ID), original) {
		t.Fatalf("repeated migration changed group assignment or ledger: %v, %v", reapplied, err)
	}
}

func TestTaskGroupMigrationRejectsRootlessLegacyCyclesAtomically(t *testing.T) {
	ctx := context.Background()
	pool := emptyPool(t)
	if err := migrate(ctx, pool, schemaMigrations[:8]); err != nil {
		t.Fatal(err)
	}
	database := &Store{Pool: pool}
	project := queryProject(t, database, 1)
	for _, id := range []string{queryID(10), queryID(11)} {
		mustQueryExec(t, database, `INSERT INTO tasks(id,project_id,title) VALUES ($1,$2,'Invalid legacy cycle')`, id, project.ID)
	}
	mustQueryExec(t, database, `INSERT INTO task_dependencies(project_id,task_id,depends_on_task_id) VALUES ($1,$2,$3),($1,$3,$2)`, project.ID, queryID(10), queryID(11))
	err := migrate(ctx, pool, schemaMigrations)
	var constraint *pgconn.PgError
	if !errors.As(err, &constraint) || constraint.Code != "23502" {
		t.Fatalf("rootless legacy data was silently assigned a group: %v", err)
	}
	var version int
	if err := pool.QueryRow(ctx, "SELECT max(version) FROM schema_migrations").Scan(&version); err != nil || version != 8 {
		t.Fatalf("failed migration changed ledger: %d, %v", version, err)
	}
	var column bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='tasks' AND column_name='group_id')`).Scan(&column); err != nil || column {
		t.Fatalf("failed migration left a partial group column: %v, %v", column, err)
	}
}
