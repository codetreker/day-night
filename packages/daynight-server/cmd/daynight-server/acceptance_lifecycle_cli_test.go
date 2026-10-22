package main

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/api"
)

type acceptanceLifecycleEvidence struct {
	Scope     string                        `json:"scope"`
	Platform  string                        `json:"platform"`
	Migration *acceptanceLifecycleMigration `json:"migration,omitempty"`
	Actions   []acceptanceLifecycleAction   `json:"actions,omitempty"`
	Refusals  []acceptanceLifecycleRefusal  `json:"refusals,omitempty"`
	Race      *acceptanceLifecycleRace      `json:"race,omitempty"`
}

type acceptanceMigrationEntry struct {
	Version   int64     `json:"version"`
	Checksum  string    `json:"checksum"`
	AppliedAt time.Time `json:"appliedAt"`
}

type acceptanceHistoricalRow struct {
	ID   string `json:"id"`
	Data string `json:"data"`
}

type acceptanceLifecycleMigration struct {
	BeforeLedger []acceptanceMigrationEntry `json:"beforeLedger"`
	AfterLedger  []acceptanceMigrationEntry `json:"afterLedger"`
	BeforeRows   []acceptanceHistoricalRow  `json:"beforeRows"`
	AfterRows    []acceptanceHistoricalRow  `json:"afterRows"`
	RestartRows  []acceptanceHistoricalRow  `json:"restartRows"`
}

type acceptanceLifecycleAction struct {
	Action string   `json:"action"`
	Before api.Task `json:"before"`
	After  api.Task `json:"after"`
	Output string   `json:"output"`
}

type acceptanceLifecycleRefusal struct {
	Code   string   `json:"code"`
	Before api.Task `json:"before"`
	After  api.Task `json:"after"`
	Stderr string   `json:"stderr"`
}

type acceptanceLifecycleRace struct {
	Kind     string                          `json:"kind"`
	Before   api.Task                        `json:"before"`
	After    api.Task                        `json:"after"`
	Requests []acceptanceCLIRequest          `json:"requests"`
	Results  []acceptanceLifecycleRaceResult `json:"results"`
}

type acceptanceLifecycleRaceResult struct {
	ExitCode int    `json:"exitCode"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
}

func newLifecycleEvidence(t *testing.T, scenario *acceptanceScenario) *acceptanceLifecycleEvidence {
	t.Helper()
	evidence := &acceptanceLifecycleEvidence{Scope: "real PostgreSQL, built process and packed installed CLI", Platform: runtime.GOOS + "/" + runtime.GOARCH}
	if err := binaryAcceptance.update(func() { scenario.Lifecycle = evidence }); err != nil {
		t.Fatal("cannot persist lifecycle scenario identity")
	}
	return evidence
}

func configureLifecycleCLI(t *testing.T, cli *acceptanceCLI, process *acceptanceProcess) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(cli.home, ".daynight", "config.yml"), []byte("serverUrl: http://"+process.address+"\n"), 0o600); err != nil {
		t.Fatal("cannot configure isolated lifecycle CLI")
	}
}

func acceptanceCLIAction(t *testing.T, cli *acceptanceCLI, process *acceptanceProcess, evidence *acceptanceLifecycleEvidence, before api.Task, action, status string) api.Task {
	t.Helper()
	count := len(acceptanceCLIMutations(process))
	output := cli.run(t, cli.caller, "task", action, before.ID, "--project", before.ProjectID, "--if-version", strconv.FormatInt(before.Version, 10))
	requests := acceptanceCLIWaitMutations(t, process, count+1)
	if len(requests) != count+1 || requests[count].Status != 200 {
		t.Fatal("installed lifecycle action did not make exactly one successful mutation")
	}
	after := acceptanceCLIJSON[api.Task](t, cli.run(t, cli.caller, "task", "show", before.ID, "--project", before.ProjectID, "--json"))
	preserved := after
	preserved.Status, preserved.Ready, preserved.Version, preserved.UpdatedAt = before.Status, before.Ready, before.Version, before.UpdatedAt
	if after.Status != status || after.Version != before.Version+1 || !after.UpdatedAt.After(before.UpdatedAt) || !reflect.DeepEqual(preserved, before) ||
		!strings.Contains(output, "Status: "+status+"\n") || !strings.Contains(output, "Version: "+strconv.FormatInt(after.Version, 10)+"\n") ||
		!strings.Contains(output, "Description: "+strings.ReplaceAll(after.Description, "\n", "\\n")+"\n") {
		t.Fatal("installed lifecycle action changed unrelated fields or lost its response")
	}
	if err := binaryAcceptance.update(func() {
		evidence.Actions = append(evidence.Actions, acceptanceLifecycleAction{Action: action, Before: before, After: after, Output: output})
	}); err != nil {
		t.Fatal("cannot persist lifecycle action response")
	}
	return after
}

func acceptanceCLIRefusal(t *testing.T, cli *acceptanceCLI, process *acceptanceProcess, evidence *acceptanceLifecycleEvidence, before api.Task, code string, arguments ...string) {
	t.Helper()
	result := cli.refuse(t, process, code, "", arguments...)
	after := acceptanceCLIJSON[api.Task](t, cli.run(t, cli.caller, "task", "show", before.ID, "--project", before.ProjectID, "--json"))
	if !reflect.DeepEqual(after, before) {
		t.Fatal("installed lifecycle refusal changed task data, version or timestamps")
	}
	if err := binaryAcceptance.update(func() {
		evidence.Refusals = append(evidence.Refusals, acceptanceLifecycleRefusal{Code: code, Before: before, After: after, Stderr: result.stderr})
	}); err != nil {
		t.Fatal("cannot persist lifecycle refusal outcome")
	}
}

func acceptanceMigrationLedger(t *testing.T, fixture *acceptanceFixture) []acceptanceMigrationEntry {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	rows, err := fixture.admin.Query(ctx, "SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version")
	if err != nil {
		t.Fatal("cannot read historical migration ledger")
	}
	defer rows.Close()
	var result []acceptanceMigrationEntry
	for rows.Next() {
		var entry acceptanceMigrationEntry
		if err := rows.Scan(&entry.Version, &entry.Checksum, &entry.AppliedAt); err != nil {
			t.Fatal("cannot decode historical migration ledger")
		}
		entry.AppliedAt = entry.AppliedAt.UTC()
		result = append(result, entry)
	}
	if err := rows.Err(); err != nil {
		t.Fatal("cannot finish historical migration ledger")
	}
	return result
}

func acceptanceHistoricalRows(t *testing.T, fixture *acceptanceFixture, ids []string) []acceptanceHistoricalRow {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	rows, err := fixture.admin.Query(ctx, "SELECT id::text, to_jsonb(t)::text FROM tasks t WHERE id = ANY($1::uuid[]) ORDER BY id", ids)
	if err != nil {
		t.Fatal("cannot read preserved historical rows")
	}
	defer rows.Close()
	var result []acceptanceHistoricalRow
	for rows.Next() {
		var row acceptanceHistoricalRow
		if err := rows.Scan(&row.ID, &row.Data); err != nil {
			t.Fatal("cannot decode preserved historical row")
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil || len(result) != len(ids) {
		t.Fatal("historical row inventory is incomplete")
	}
	return result
}

func acceptancePreLifecycleSchema(t *testing.T, fixture *acceptanceFixture) {
	t.Helper()
	fixture.exec(t, `CREATE TABLE schema_migrations (version bigint PRIMARY KEY, checksum text NOT NULL CHECK (length(checksum) = 64), applied_at timestamptz NOT NULL DEFAULT statement_timestamp())`)
	for index, name := range []string{"001_projects.sql", "002_tasks.sql", "003_task_properties.sql", "004_task_attachments.sql", "005_identity.sql", "006_project_membership.sql"} {
		data, err := os.ReadFile(filepath.Join("..", "..", "internal", "core", "store", "migrations", name))
		if err != nil {
			t.Fatal("cannot read genuine pre-lifecycle migration SQL")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		tx, err := fixture.admin.Begin(ctx)
		if err == nil {
			_, err = tx.Exec(ctx, string(data))
			if err == nil {
				_, err = tx.Exec(ctx, "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", index+1, fmt.Sprintf("%x", sha256.Sum256(data)))
			}
			if err == nil {
				err = tx.Commit(ctx)
			} else {
				_ = tx.Rollback(ctx)
			}
		}
		cancel()
		if err != nil {
			t.Fatal("cannot apply genuine pre-lifecycle migration")
		}
	}
}

func acceptanceLifecycleAttachment(t *testing.T, cli *acceptanceCLI, task api.Task) ([]api.Attachment, []byte) {
	t.Helper()
	content := []byte("# Lifecycle acceptance plan\n\nMetadata and exact attachment bytes survive every transition.\n\nReadable plan: 审批后领取，验收后完成。\n")
	source := filepath.Join(cli.root, "lifecycle-plan.md")
	if err := os.WriteFile(source, content, 0o600); err != nil {
		t.Fatal("cannot create owned lifecycle attachment")
	}
	cli.run(t, cli.caller, "task", "attachment", "put", task.ID, source, "--project", task.ProjectID, "--path", "plans/lifecycle.md")
	metadata := acceptanceCLIJSON[[]api.Attachment](t, cli.run(t, cli.caller, "task", "attachment", "list", task.ID, "--project", task.ProjectID, "--json"))
	if len(metadata) != 1 || metadata[0].Path != "plans/lifecycle.md" || metadata[0].SizeBytes != int64(len(content)) {
		t.Fatal("installed lifecycle attachment did not retain its metadata")
	}
	return metadata, content
}

func acceptanceLifecycleAttachmentUnchanged(t *testing.T, cli *acceptanceCLI, task api.Task, metadata []api.Attachment, content []byte) {
	t.Helper()
	actual := acceptanceCLIJSON[[]api.Attachment](t, cli.run(t, cli.caller, "task", "attachment", "list", task.ID, "--project", task.ProjectID, "--json"))
	if !reflect.DeepEqual(actual, metadata) {
		t.Fatal("lifecycle changed attachment metadata")
	}
	bytes := cli.run(t, cli.caller, "task", "attachment", "read", task.ID, metadata[0].Path, "--project", task.ProjectID)
	if bytes != string(content) {
		t.Fatal("lifecycle changed exact attachment bytes")
	}
}

func TestInstalledCLIPreLifecycleMigrationAcceptance(t *testing.T) {
	receipt := readAcceptanceCLI(t)
	acceptanceCase(t, "installed_cli_pre_lifecycle_migration_restart", []string{"ST-T3.AC1", "ST-T3.AC4", "ST-T3.AC6"}, func(t *testing.T, scenario *acceptanceScenario) {
		fixture := newAcceptanceFixture(t, scenario)
		cli := newAcceptanceCLI(t, receipt, scenario)
		evidence := newLifecycleEvidence(t, scenario)
		acceptancePreLifecycleSchema(t, fixture)
		projectID := "00000000-0000-4000-8000-000000000010"
		ids := []string{"00000000-0000-4000-8000-000000000011", "00000000-0000-4000-8000-000000000012", "00000000-0000-4000-8000-000000000013"}
		stamp := time.Date(2026, 1, 2, 3, 4, 5, 123456000, time.UTC)
		fixture.exec(t, "INSERT INTO projects (id, name, repo_url) VALUES ($1, 'Pre-lifecycle preserved', 'git@git.example:Org/Repo.git')", projectID)
		properties := api.TaskProperties{PullRequests: []api.PullRequestProperty{{URL: "https://github.com/example/migration/pull/1", Title: "Historical reference"}}}
		encoded, err := json.Marshal(properties)
		if err != nil {
			t.Fatal("cannot encode historical task properties")
		}
		fixture.exec(t, `INSERT INTO tasks (id, project_id, title, description, properties, version, created_at, updated_at)
			VALUES ($1, $2, 'Historical todo', 'Original approved work', $3, 17, $4, $5)`, ids[0], projectID, string(encoded), stamp, stamp.Add(time.Hour))
		for index, status := range []string{"in_progress", "done"} {
			fixture.exec(t, `INSERT INTO tasks (id, project_id, title, description, properties, status, version, created_at, updated_at)
				VALUES ($1, $2, $3, 'Original task description', $4, $5, $6, $7, $8)`, ids[index+1], projectID, "Historical "+status, string(encoded), status, int64(23+index), stamp, stamp.Add(time.Hour))
		}
		fixture.exec(t, `INSERT INTO task_dependencies (project_id, task_id, depends_on_task_id) VALUES ($1, $2, $4), ($1, $3, $4)`, projectID, ids[0], ids[1], ids[2])
		migration := &acceptanceLifecycleMigration{BeforeLedger: acceptanceMigrationLedger(t, fixture), BeforeRows: acceptanceHistoricalRows(t, fixture, ids)}
		if len(migration.BeforeLedger) != 6 || !strings.Contains(migration.BeforeRows[0].Data, `"status": "todo"`) {
			t.Fatal("historical fixture did not use the actual pre-lifecycle schema/default")
		}
		if err := binaryAcceptance.update(func() { evidence.Migration = migration }); err != nil {
			t.Fatal("cannot persist pre-migration resource snapshots")
		}
		process := fixture.launch(t, nil).started(t)
		configureLifecycleCLI(t, cli, process)
		afterLedger := acceptanceMigrationLedger(t, fixture)
		afterRows := acceptanceHistoricalRows(t, fixture, ids)
		if err := binaryAcceptance.update(func() { migration.AfterLedger, migration.AfterRows = afterLedger, afterRows }); err != nil {
			t.Fatal("cannot persist migrated ledger and resource snapshots")
		}
		if len(migration.AfterLedger) != 8 || !reflect.DeepEqual(migration.AfterLedger[:6], migration.BeforeLedger) ||
			migration.AfterLedger[6].Version != 7 || migration.AfterLedger[7].Version != 8 || !reflect.DeepEqual(migration.AfterRows, migration.BeforeRows) {
			t.Fatal("built startup did not append genuine migrations while preserving old rows and ledger")
		}
		old := make([]api.Task, len(ids))
		for index, id := range ids {
			old[index] = acceptanceCLIJSON[api.Task](t, cli.run(t, cli.caller, "task", "show", id, "--project", projectID, "--json"))
			if old[index].Status != []string{"todo", "in_progress", "done"}[index] || old[index].Version != []int64{17, 23, 24}[index] ||
				!old[index].CreatedAt.Equal(stamp) || !old[index].UpdatedAt.Equal(stamp.Add(time.Hour)) || !reflect.DeepEqual(old[index].Properties, properties) {
				t.Fatal("installed CLI changed a preserved historical resource")
			}
		}
		acceptanceCLITaskListJSON(t, cli.run(t, cli.caller, "task", "list", "--project", projectID, "--all", "--json"), []api.Task{old[1], old[0], old[2]})
		graph := acceptanceCLIJSON[api.TaskGraph](t, cli.run(t, cli.caller, "task", "graph", "--project", projectID, "--json"))
		if graph.Summary != (api.TaskGraphSummary{Total: 3, Todo: 1, InProgress: 1, Done: 1, Ready: 1}) {
			t.Fatal("installed graph changed the migrated historical states")
		}
		create := func(title string, dependencies ...string) api.Task {
			arguments := []string{"task", "create", "--project", projectID, "--title", title, "--description", "Complete lifecycle plan. Attachment: plans/lifecycle.md\nPreserve this full description.", "--pull-request-url", properties.PullRequests[0].URL, "--pull-request-title", properties.PullRequests[0].Title}
			for _, id := range dependencies {
				arguments = append(arguments, "--depends-on", id)
			}
			id := acceptanceCLIResourceID(t, cli.run(t, cli.caller, arguments...))
			task := acceptanceCLIJSON[api.Task](t, cli.run(t, cli.caller, "task", "show", id, "--project", projectID, "--json"))
			if task.Status != "proposed" || task.Version != 1 || task.Ready || !reflect.DeepEqual(task.Properties, properties) {
				t.Fatal("installed creation after genuine migration did not produce proposed work")
			}
			return task
		}
		prerequisite := create("Migrated prerequisite")
		prerequisiteMetadata, prerequisiteContent := acceptanceLifecycleAttachment(t, cli, prerequisite)
		dependent := create("Migrated dependent", prerequisite.ID)
		metadata, content := acceptanceLifecycleAttachment(t, cli, dependent)
		acceptanceCLITaskListJSON(t, cli.run(t, cli.caller, "task", "list", "--project", projectID, "--json"), []api.Task{old[1], old[0], prerequisite, dependent})
		readyInventory := acceptanceCLIJSON[[]api.Task](t, cli.run(t, cli.caller, "task", "ready", "--project", projectID, "--json"))
		if !reflect.DeepEqual(readyInventory, []api.Task{old[0]}) {
			t.Fatal("proposed tasks leaked into the installed ready inventory after migration")
		}
		proposedGraph := acceptanceCLIJSON[api.TaskGraph](t, cli.run(t, cli.caller, "task", "graph", "--project", projectID, "--json"))
		if proposedGraph.Summary != (api.TaskGraphSummary{Total: 5, Proposed: 2, Todo: 1, InProgress: 1, Done: 1, Ready: 1}) {
			t.Fatal("migrated service and installed CLI disagreed on the four-state graph")
		}
		dependent = acceptanceCLIAction(t, cli, process, evidence, dependent, "approve", "todo")
		acceptanceLifecycleAttachmentUnchanged(t, cli, dependent, metadata, content)
		acceptanceCLIRefusal(t, cli, process, evidence, dependent, "dependency_unsatisfied", "task", "claim", dependent.ID, "--project", projectID, "--if-version", "2")
		acceptanceCLIRefusal(t, cli, process, evidence, dependent, "version_conflict", "task", "claim", dependent.ID, "--project", projectID, "--if-version", "1")
		for _, step := range []struct{ action, status string }{{"approve", "todo"}, {"claim", "in_progress"}, {"complete", "done"}} {
			prerequisite = acceptanceCLIAction(t, cli, process, evidence, prerequisite, step.action, step.status)
			acceptanceLifecycleAttachmentUnchanged(t, cli, prerequisite, prerequisiteMetadata, prerequisiteContent)
		}
		ready := acceptanceCLIJSON[api.Task](t, cli.run(t, cli.caller, "task", "show", dependent.ID, "--project", projectID, "--json"))
		preserved := ready
		preserved.Ready, preserved.BlockedBy = dependent.Ready, dependent.BlockedBy
		if !ready.Ready || len(ready.BlockedBy) != 0 || !reflect.DeepEqual(preserved, dependent) {
			t.Fatal("prerequisite completion changed dependent metadata or failed to unblock approved work")
		}
		dependent = acceptanceCLIAction(t, cli, process, evidence, ready, "claim", "in_progress")
		acceptanceLifecycleAttachmentUnchanged(t, cli, dependent, metadata, content)
		dependent = acceptanceCLIAction(t, cli, process, evidence, dependent, "complete", "done")
		acceptanceLifecycleAttachmentUnchanged(t, cli, prerequisite, prerequisiteMetadata, prerequisiteContent)
		acceptanceLifecycleAttachmentUnchanged(t, cli, dependent, metadata, content)
		defaultID := "00000000-0000-4000-8000-000000000014"
		fixture.exec(t, `INSERT INTO tasks (id, project_id, title) VALUES ($1, $2, 'Post-migration SQL default')`, defaultID, projectID)
		defaultTask := acceptanceCLIJSON[api.Task](t, cli.run(t, cli.caller, "task", "show", defaultID, "--project", projectID, "--json"))
		if defaultTask.Status != "proposed" || defaultTask.Version != 1 || defaultTask.Ready {
			t.Fatal("genuine migration did not change the SQL creation default to proposed")
		}
		process.signal(t)
		process.stopped(t, 0)
		restarted := fixture.launch(t, map[string]string{"DAYNIGHT_LISTEN_ADDR": process.address}).started(t)
		if restarted.address != process.address {
			t.Fatal("migration restart did not reuse the released service listener")
		}
		for _, before := range append(slices.Clone(old), prerequisite, dependent, defaultTask) {
			after := acceptanceCLIJSON[api.Task](t, cli.run(t, cli.caller, "task", "show", before.ID, "--project", projectID, "--json"))
			if !reflect.DeepEqual(after, before) {
				t.Fatal("historical or newly advanced lifecycle state changed across actual restart")
			}
		}
		acceptanceLifecycleAttachmentUnchanged(t, cli, prerequisite, prerequisiteMetadata, prerequisiteContent)
		acceptanceLifecycleAttachmentUnchanged(t, cli, dependent, metadata, content)
		restartRows := acceptanceHistoricalRows(t, fixture, ids)
		if err := binaryAcceptance.update(func() { migration.RestartRows = restartRows }); err != nil {
			t.Fatal("cannot persist restarted historical resource snapshots")
		}
		if !reflect.DeepEqual(migration.RestartRows, migration.BeforeRows) || !reflect.DeepEqual(acceptanceMigrationLedger(t, fixture), migration.AfterLedger) {
			t.Fatal("restart changed old stored rows or the applied migration ledger")
		}
		if err := binaryAcceptance.update(func() {
			scenario.AttachmentFiles = append(scenario.AttachmentFiles, acceptanceAttachmentEvidence{Path: metadata[0].Path, SizeBytes: len(content), SHA256: fmt.Sprintf("%x", sha256.Sum256(content))})
		}); err != nil {
			t.Fatal("cannot persist migration/restart attachment evidence")
		}
		restarted.signal(t)
		restarted.stopped(t, 0)
	})
}

func TestInstalledCLILifecycleRacesAcceptance(t *testing.T) {
	receipt := readAcceptanceCLI(t)
	for _, kind := range []string{"claim", "dependency_edit_and_claim"} {
		acceptanceCase(t, "installed_cli_same_version_"+kind, []string{"ST-T3.AC1", "ST-T3.AC3", "ST-T3.AC6"}, func(t *testing.T, scenario *acceptanceScenario) {
			fixture := newAcceptanceFixture(t, scenario)
			cli := newAcceptanceCLI(t, receipt, scenario)
			evidence := newLifecycleEvidence(t, scenario)
			process := fixture.launch(t, nil).started(t)
			configureLifecycleCLI(t, cli, process)
			projectID := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "project", "create", "Installed lifecycle race"))
			prerequisiteID := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "Unfinished prerequisite"))
			id := acceptanceCLIResourceID(t, cli.run(t, cli.repo, "task", "create", "--title", "Competing accepted work", "--description", "Complete preserved description. Attachment: plans/lifecycle.md\nReview before claiming.", "--pull-request-url", "https://github.com/example/race/pull/9", "--pull-request-title", "Preserved PR reference"))
			before := cli.task(t, id)
			metadata, content := acceptanceLifecycleAttachment(t, cli, before)
			before = acceptanceCLIAction(t, cli, process, evidence, before, "approve", "todo")
			version := strconv.FormatInt(before.Version, 10)
			count := len(acceptanceCLIMutations(process))
			barrier := fixture.projectLock(t, projectID)
			left := cli.start(t, cli.caller, "task", "claim", id, "--project", projectID, "--if-version", version)
			var right <-chan acceptanceCLIResult
			if kind == "claim" {
				right = cli.start(t, cli.caller, "task", "claim", id, "--project", projectID, "--if-version", version)
			} else {
				right = cli.start(t, cli.caller, "task", "update", id, "--project", projectID, "--if-version", version, "--depends-on", prerequisiteID)
			}
			fixture.waitWriters(t, process, 2)
			acceptanceRelease(t, barrier)
			results := []acceptanceCLIResult{acceptanceCLIReceive(t, left), acceptanceCLIReceive(t, right)}
			requests := acceptanceCLIWaitMutations(t, process, count+2)
			if len(requests) != count+2 {
				t.Fatal("installed lifecycle competition retried a mutation")
			}
			requests = requests[count:]
			statuses := []int{requests[0].Status, requests[1].Status}
			slices.Sort(statuses)
			if !slices.Equal(statuses, []int{200, 409}) || requests[0].RequestID == "" || requests[1].RequestID == "" || requests[0].RequestID == requests[1].RequestID {
				t.Fatal("installed lifecycle competition lost exactly one success and one correlated conflict")
			}
			won, lost := 0, 0
			captured := make([]acceptanceLifecycleRaceResult, 0, 2)
			for _, result := range results {
				captured = append(captured, acceptanceLifecycleRaceResult{ExitCode: result.status, Stdout: result.stdout, Stderr: result.stderr})
				if result.status == 0 && result.stderr == "" && strings.Contains(result.stdout, "Version: "+strconv.FormatInt(before.Version+1, 10)+"\n") {
					won++
					continue
				}
				if result.status == 1 && result.stdout == "" && strings.Contains(result.stderr, "version_conflict") && strings.Contains(result.stderr, id) {
					matched := false
					for _, request := range requests {
						if request.Status == 409 && strings.Contains(result.stderr, "requestId="+request.RequestID) {
							matched = true
						}
					}
					if matched {
						lost++
						continue
					}
				}
				t.Fatalf("installed lifecycle competition returned an unexpected process result: %+v", result)
			}
			if won != 1 || lost != 1 {
				t.Fatal("installed lifecycle competition did not expose one winning process and one conflict")
			}
			after := cli.task(t, id)
			preserved := after
			preserved.Status, preserved.Ready, preserved.Version, preserved.UpdatedAt = before.Status, before.Ready, before.Version, before.UpdatedAt
			preserved.DependsOn, preserved.BlockedBy = before.DependsOn, before.BlockedBy
			if after.Version != before.Version+1 || !after.UpdatedAt.After(before.UpdatedAt) || !reflect.DeepEqual(preserved, before) || after.Ready {
				t.Fatal("installed lifecycle competition changed unrelated metadata or committed more than once")
			}
			if kind == "claim" {
				if after.Status != "in_progress" || len(after.DependsOn) != 0 || len(after.BlockedBy) != 0 {
					t.Fatal("same-version installed claims did not commit exactly one valid claim")
				}
			} else if after.Status == "todo" {
				if !slices.Equal(after.DependsOn, []string{prerequisiteID}) || !slices.Equal(after.BlockedBy, []string{prerequisiteID}) {
					t.Fatal("dependency winner did not leave approved work blocked by its unfinished prerequisite")
				}
			} else if after.Status != "in_progress" || len(after.DependsOn) != 0 || len(after.BlockedBy) != 0 {
				t.Fatal("dependency-edit/claim competition gave active work an unfinished prerequisite")
			}
			acceptanceLifecycleAttachmentUnchanged(t, cli, after, metadata, content)
			if prerequisite := cli.task(t, prerequisiteID); prerequisite.Status != "proposed" || prerequisite.Version != 1 || prerequisite.Ready {
				t.Fatal("installed lifecycle competition mutated its prerequisite")
			}
			if err := binaryAcceptance.update(func() {
				evidence.Race = &acceptanceLifecycleRace{Kind: kind, Before: before, After: after, Requests: requests, Results: captured}
				scenario.AttachmentFiles = append(scenario.AttachmentFiles, acceptanceAttachmentEvidence{Path: metadata[0].Path, SizeBytes: len(content), SHA256: fmt.Sprintf("%x", sha256.Sum256(content))})
			}); err != nil {
				t.Fatal("cannot persist actual installed lifecycle race outcomes")
			}
			process.signal(t)
			process.stopped(t, 0)
		})
	}
}
