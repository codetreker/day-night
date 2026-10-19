package service

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type taskQueryAction struct {
	match func(string) bool
	start func()
	end   func()
}

type taskQueryKey struct{}

func (action taskQueryAction) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	matched := action.match(data.SQL)
	if matched && action.start != nil {
		action.start()
	}
	return context.WithValue(ctx, taskQueryKey{}, matched)
}

func (action taskQueryAction) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	if ctx.Value(taskQueryKey{}) == true && action.end != nil {
		action.end()
	}
}

func tracedTasks(t *testing.T, databaseURL string, action taskQueryAction) *Tasks {
	t.Helper()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.Tracer = action
	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return NewTasks(&store.Store{Pool: pool})
}

func assertOperational(t *testing.T, err error) {
	t.Helper()
	var fault *Fault
	if err == nil || errors.As(err, &fault) {
		t.Fatalf("operational error was masked: %#v", err)
	}
}

func TestTaskReadAndWriteDatabaseFailures(t *testing.T) {
	for _, table := range []string{"tasks", "projects"} {
		t.Run(table, func(t *testing.T) {
			tasks, database, project, _ := taskService(t)
			target := createTask(t, tasks, project.ID, "Target")
			if _, err := database.Pool.Exec(context.Background(), "DROP TABLE "+table); err != nil {
				t.Fatal(err)
			}
			_, getErr := tasks.Get(context.Background(), project.ID, target.ID)
			_, listErr := tasks.List(context.Background(), project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 10}})
			_, updateErr := tasks.Update(context.Background(), project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer("Changed")})
			_, createErr := tasks.Create(context.Background(), project.ID, CreateTask{Title: "New"})
			for _, err := range []error{getErr, listErr, updateErr, createErr} {
				assertOperational(t, err)
				var pgError *pgconn.PgError
				if !errors.As(err, &pgError) || pgError.Code != "42P01" {
					t.Fatalf("missing query cause: %v", err)
				}
			}
		})
	}
	tasks, database, project, _ := taskService(t)
	database.Close()
	_, err := tasks.List(context.Background(), project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 10}})
	assertOperational(t, err)
}

func TestTaskPolicyQueryCancellationPreservesCause(t *testing.T) {
	tasks, _, project, databaseURL := taskService(t)
	predecessor := createTask(t, tasks, project.ID, "Predecessor")
	predecessor = updateTask(t, tasks, predecessor, UpdateTask{Status: pointer(core.TaskDone)})
	target := createTask(t, tasks, project.ID, "Target", predecessor.ID)
	target = updateTask(t, tasks, target, UpdateTask{Status: pointer(core.TaskDone)})
	for _, fragment := range []string{"t.id = ANY($2::uuid[])", "WITH RECURSIVE edges", "d.depends_on_task_id = $2)"} {
		t.Run(fragment, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			traced := tracedTasks(t, databaseURL, taskQueryAction{match: func(sql string) bool { return strings.Contains(sql, fragment) }, start: cancel})
			input := UpdateTask{Version: target.Version, Title: pointer("Rejected")}
			id := target.ID
			if strings.HasPrefix(fragment, "d.") {
				id = predecessor.ID
				input = UpdateTask{Version: predecessor.Version, Status: pointer(core.TaskTodo)}
			}
			_, err := traced.Update(ctx, project.ID, id, input)
			assertOperational(t, err)
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("query cancellation cause: %v", err)
			}
			assertTaskUnchanged(t, tasks, target)
			assertTaskUnchanged(t, tasks, predecessor)
		})
	}
}

func TestTaskTransactionCompletionFailureDominatesDomainFault(t *testing.T) {
	tasks, _, project, databaseURL := taskService(t)
	target := createTask(t, tasks, project.ID, "Target")
	missing := "00000000-0000-0000-0000-000000000000"
	for _, test := range []struct {
		name      string
		fragment  string
		operation func(context.Context, *Tasks) error
	}{
		{"missing task read", "FROM tasks t", func(ctx context.Context, s *Tasks) error { _, err := s.Get(ctx, project.ID, missing); return err }},
		{"missing task update", "FROM tasks t", func(ctx context.Context, s *Tasks) error {
			_, err := s.Update(ctx, project.ID, missing, UpdateTask{Version: 1, Title: pointer("Rejected")})
			return err
		}},
		{"stale version update", "FROM tasks t", func(ctx context.Context, s *Tasks) error {
			_, err := s.Update(ctx, project.ID, target.ID, UpdateTask{Version: 2, Title: pointer("Rejected")})
			return err
		}},
		{"invalid dependency create", "t.id = ANY($2::uuid[])", func(ctx context.Context, s *Tasks) error {
			_, err := s.Create(ctx, project.ID, CreateTask{Title: "Rejected", DependsOn: []string{missing}})
			return err
		}},
		{"missing project read", "FROM projects WHERE id =", func(ctx context.Context, s *Tasks) error { _, err := s.Get(ctx, missing, target.ID); return err }},
		{"missing project list", "FROM projects WHERE id =", func(ctx context.Context, s *Tasks) error {
			_, err := s.List(ctx, missing, TaskListRequest{PageRequest: PageRequest{Limit: 10}})
			return err
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			traced := tracedTasks(t, databaseURL, taskQueryAction{match: func(sql string) bool { return strings.Contains(sql, test.fragment) }, end: cancel})
			err := test.operation(ctx, traced)
			assertOperational(t, err)
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("completion failure lost cause: %v", err)
			}
			assertTaskUnchanged(t, tasks, target)
		})
	}
}

func TestTaskPartialWriteFailureRollsBackMetadataAndAllEdges(t *testing.T) {
	tasks, database, project, _ := taskService(t)
	ctx := context.Background()
	a := createTask(t, tasks, project.ID, "A")
	b := createTask(t, tasks, project.ID, "B")
	old := createTask(t, tasks, project.ID, "Old")
	target := createTask(t, tasks, project.ID, "Target", old.ID)
	dependencies := []string{a.ID, b.ID}
	slices.Sort(dependencies)
	statement := fmt.Sprintf(`CREATE FUNCTION reject_second_edge() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN IF NEW.depends_on_task_id = '%s'::uuid THEN RAISE EXCEPTION 'private edge diagnostic'; END IF; RETURN NEW; END $$;
		CREATE TRIGGER reject_second_edge BEFORE INSERT ON task_dependencies FOR EACH ROW EXECUTE FUNCTION reject_second_edge()`, dependencies[1])
	if _, err := database.Pool.Exec(ctx, statement); err != nil {
		t.Fatal(err)
	}
	_, updateErr := tasks.Update(ctx, project.ID, target.ID, UpdateTask{Version: target.Version, Title: pointer("Changed"), Description: pointer("Changed"), DependsOn: &dependencies})
	_, createErr := tasks.Create(ctx, project.ID, CreateTask{Title: "Rejected create", DependsOn: dependencies})
	for _, err := range []error{updateErr, createErr} {
		assertOperational(t, err)
		var pgError *pgconn.PgError
		if !errors.As(err, &pgError) || pgError.Code != "P0001" || strings.Contains(err.Error(), "private edge") {
			t.Fatalf("partial failure cause/redaction: %v", err)
		}
	}
	assertTaskUnchanged(t, tasks, target)
	page, err := tasks.List(ctx, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 100}})
	if err != nil || len(page.Items) != 4 {
		t.Fatalf("failed creation left rows: %#v, %v", page, err)
	}
}

func TestTaskSnapshotKeepsProjectAndDerivedTaskStateConsistent(t *testing.T) {
	tasks, database, project, databaseURL := taskService(t)
	predecessor := createTask(t, tasks, project.ID, "Predecessor")
	target := createTask(t, tasks, project.ID, "Target", predecessor.ID)
	traced := tracedTasks(t, databaseURL, taskQueryAction{
		match: func(sql string) bool { return strings.Contains(sql, "FROM projects WHERE id =") },
		end: func() {
			if err := database.WriteProject(context.Background(), project.ID, func(tx *store.ProjectTx) error {
				_, err := tx.UpdateTask(context.Background(), predecessor.ID, store.TaskWrite{Title: predecessor.Title, Status: core.TaskDone})
				return err
			}); err != nil {
				t.Fatal(err)
			}
		},
	})
	read, err := traced.Get(context.Background(), project.ID, target.ID)
	if err != nil || read.Ready || !slices.Equal(read.BlockedBy, []string{predecessor.ID}) {
		t.Fatalf("RR task read mixed snapshots: %#v, %v", read, err)
	}
	fresh, err := tasks.Get(context.Background(), project.ID, target.ID)
	if err != nil || !fresh.Ready || len(fresh.BlockedBy) != 0 || fresh.Version != target.Version || !fresh.UpdatedAt.Equal(target.UpdatedAt) {
		t.Fatalf("fresh read/metadata: %#v, %v", fresh, err)
	}
}
