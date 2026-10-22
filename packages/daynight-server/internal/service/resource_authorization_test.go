package service

import (
	"context"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
	"github.com/codetreker/daynight/packages/daynight-server/internal/filestorage"
	"github.com/codetreker/daynight/packages/daynight-server/internal/filestorage/local"
	"github.com/google/uuid"
)

func TestResourceServicesRejectAbsentPrincipals(t *testing.T) {
	ctx := context.Background()
	id := uuid.NewString()
	projects, tasks, attachments := NewProjects(nil), NewTasks(nil), NewAttachments(nil, nil)
	for _, principal := range []core.Principal{{}, {UserID: id, CredentialID: id, Kind: "unknown"}} {
		calls := []func() error{
			func() error { _, err := projects.Get(ctx, principal, id); return err },
			func() error { _, err := tasks.Create(ctx, principal, id, CreateTask{Title: "Hidden"}); return err },
			func() error {
				_, err := tasks.Update(ctx, principal, id, id, UpdateTask{Version: 1, Title: pointer("Hidden")})
				return err
			},
			func() error { _, err := tasks.Get(ctx, principal, id, id); return err },
			func() error {
				_, err := tasks.List(ctx, principal, id, TaskListRequest{PageRequest: PageRequest{Limit: 1}})
				return err
			},
			func() error { _, err := tasks.Graph(ctx, principal, id); return err },
			func() error { _, err := attachments.List(ctx, principal, id, id, PageRequest{Limit: 1}); return err },
			func() error {
				_, _, err := attachments.Put(ctx, principal, id, id, "file", "text/plain", strings.NewReader("content"))
				return err
			},
			func() error { _, _, err := attachments.Open(ctx, principal, id, id, "file"); return err },
			func() error { return attachments.Delete(ctx, principal, id, id, "file") },
		}
		for _, call := range calls {
			requireFault(t, call(), "unauthenticated")
		}
	}
}

func TestAllResourcesRequireCurrentProjectMembership(t *testing.T) {
	f := newMembershipFixture(t)
	admin, member, outsider := f.user(t), f.user(t), f.user(t)
	project := f.project(t, admin, "Shared private resources")
	joined := f.join(t, admin, member, project.ID)
	tasks := NewTasks(f.database)
	task := createTask(t, tasks, admin, project.ID, "Private task")
	files, err := local.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := files.Close(); err != nil {
			t.Error(err)
		}
	})
	probe := &authorizationStorage{Storage: files}
	attachments := NewAttachments(f.database, probe)
	putAttachment(t, attachments, admin, task, "secret.html", "<h1>same-origin</h1>")
	ctx := context.Background()
	readAndWrite := func(principal core.Principal) []func() error {
		return []func() error{
			func() error { _, err := f.projects.Get(ctx, principal, project.ID); return err },
			func() error { _, err := tasks.Get(ctx, principal, project.ID, task.ID); return err },
			func() error {
				_, err := tasks.List(ctx, principal, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 1}})
				return err
			},
			func() error { _, err := tasks.Graph(ctx, principal, project.ID); return err },
			func() error {
				_, err := tasks.Create(ctx, principal, project.ID, CreateTask{Title: "Attempt"})
				return err
			},
			func() error {
				_, err := tasks.Update(ctx, principal, project.ID, task.ID, UpdateTask{Version: task.Version, Title: pointer(task.Title)})
				return err
			},
			func() error {
				_, err := attachments.List(ctx, principal, project.ID, task.ID, PageRequest{Limit: 1})
				return err
			},
			func() error {
				_, object, err := attachments.Open(ctx, principal, project.ID, task.ID, "secret.html")
				if err == nil {
					err = object.Body.Close()
				}
				return err
			},
			func() error {
				_, _, err := attachments.Put(ctx, principal, project.ID, task.ID, "member.txt", "text/plain", strings.NewReader("Member write"))
				return err
			},
			func() error { return attachments.Delete(ctx, principal, project.ID, task.ID, "member.txt") },
		}
	}
	for _, principal := range []core.Principal{outsider, {}} {
		before := probe.count()
		for _, call := range readAndWrite(principal) {
			code := "not_found"
			if principal.UserID == "" {
				code = "unauthenticated"
			}
			requireFault(t, call(), code)
		}
		if probe.count() != before {
			t.Fatal("unadmitted request reached filesystem")
		}
	}
	for _, call := range readAndWrite(member) {
		if err := call(); err != nil {
			t.Fatalf("member resource authority: %v", err)
		}
	}
	if err := f.memberships.Remove(ctx, admin, project.ID, member.UserID, joined.Version); err != nil {
		t.Fatal(err)
	}
	before := probe.count()
	for _, call := range readAndWrite(member) {
		requireFault(t, call(), "not_found")
	}
	if probe.count() != before {
		t.Fatal("removed member reached filesystem")
	}
	page, err := f.projects.List(ctx, member, PageRequest{Limit: 1})
	if err != nil || len(page.Items) != 0 || page.NextCursor != nil {
		t.Fatalf("removed member project list: %#v %v", page, err)
	}
}

type authorizationStorage struct {
	filestorage.Storage
	mu       sync.Mutex
	calls    int
	admitted chan struct{}
	release  chan struct{}
}

func (s *authorizationStorage) count() int { s.mu.Lock(); defer s.mu.Unlock(); return s.calls }
func (s *authorizationStorage) enter() {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	if s.admitted != nil {
		close(s.admitted)
		<-s.release
	}
}
func (s *authorizationStorage) Put(ctx context.Context, bucket, path string, content io.Reader) (filestorage.FileInfo, error) {
	s.enter()
	return s.Storage.Put(ctx, bucket, path, content)
}
func (s *authorizationStorage) Open(ctx context.Context, bucket, path string) (filestorage.Object, error) {
	s.enter()
	return s.Storage.Open(ctx, bucket, path)
}
func (s *authorizationStorage) Delete(ctx context.Context, bucket, path string) error {
	s.enter()
	return s.Storage.Delete(ctx, bucket, path)
}

func TestAdmittedAttachmentWriteFinishesAfterMemberRemoval(t *testing.T) {
	f := newMembershipFixture(t)
	admin, member := f.user(t), f.user(t)
	project := f.project(t, admin, "Admission")
	joined := f.join(t, admin, member, project.ID)
	tasks := NewTasks(f.database)
	task := createTask(t, tasks, admin, project.ID, "Attachment admission")
	files, err := local.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := files.Close(); err != nil {
			t.Error(err)
		}
	})
	probe := &authorizationStorage{Storage: files, admitted: make(chan struct{}), release: make(chan struct{})}
	attachments := NewAttachments(f.database, probe)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, _, err := attachments.Put(ctx, member, project.ID, task.ID, "admitted.txt", "text/plain", strings.NewReader("Admitted"))
		result <- err
	}()
	select {
	case <-probe.admitted:
	case err := <-result:
		t.Fatalf("write failed before admission: %v", err)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if err := f.memberships.Remove(context.Background(), admin, project.ID, member.UserID, joined.Version); err != nil {
		close(probe.release)
		t.Fatal(err)
	}
	close(probe.release)
	if err := <-result; err != nil {
		t.Fatalf("admitted write refused after removal: %v", err)
	}
	_, _, err = attachments.Put(context.Background(), member, project.ID, task.ID, "later.txt", "text/plain", strings.NewReader("Later"))
	requireFault(t, err, "not_found")
	if probe.count() != 1 {
		t.Fatal("later write reached filesystem")
	}
	read := NewAttachments(f.database, files)
	_, object, err := read.Open(context.Background(), admin, project.ID, task.ID, "admitted.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer object.Body.Close()
	content, err := io.ReadAll(object.Body)
	if err != nil || string(content) != "Admitted" {
		t.Fatalf("admitted content: %q %v", content, err)
	}
}

func TestRevokedPATCannotAuthenticateForAnotherResourceRequest(t *testing.T) {
	f := newMembershipFixture(t)
	owner := f.user(t)
	project := f.project(t, owner, "Revoked automation credential")
	identity := NewIdentity(f.database, nil, "")
	identity.now = func() time.Time { return f.now }
	ctx := context.Background()
	token, err := identity.CreatePAT(ctx, owner, CreatePAT{Name: "Resource access", Days: 1})
	if err != nil {
		t.Fatal(err)
	}
	principal, err := identity.Authenticate(ctx, core.PATCredential, token.Secret)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.projects.Get(ctx, principal, project.ID); err != nil {
		t.Fatalf("live PAT resource access: %v", err)
	}
	if err := identity.RevokePAT(ctx, owner, token.Credential.ID); err != nil {
		t.Fatal(err)
	}
	_, err = identity.Authenticate(ctx, core.PATCredential, token.Secret)
	requireFault(t, err, "unauthenticated")
}

func TestTaskWriteChecksMembershipAfterAcquiringProjectLock(t *testing.T) {
	f := newMembershipFixture(t)
	admin, member := f.user(t), f.user(t)
	project := f.project(t, admin, "Membership write ordering")
	f.join(t, admin, member, project.ID)
	tasks := NewTasks(f.database)
	task := createTask(t, tasks, admin, project.ID, "Unchanged")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	results := make(chan taskResult, 2)
	if err := f.database.WriteProject(ctx, project.ID, func(tx *store.ProjectTx) error {
		if err := tx.RemoveMember(ctx, member.UserID); err != nil {
			return err
		}
		go func() {
			created, err := tasks.Create(ctx, member, project.ID, CreateTask{Title: "Must not exist"})
			results <- taskResult{task: created, err: err}
		}()
		go func() {
			updated, err := tasks.Update(ctx, member, project.ID, task.ID, UpdateTask{Version: task.Version, Title: pointer("Must not change")})
			results <- taskResult{task: updated, err: err}
		}()
		waitForTaskWriters(t, ctx, f.database, 2)
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		requireFault(t, receiveTaskResult(t, ctx, results).err, "not_found")
	}
	assertTaskUnchanged(t, tasks, admin, task)
	page, err := tasks.List(ctx, admin, project.ID, TaskListRequest{PageRequest: PageRequest{Limit: 100}})
	if err != nil || len(page.Items) != 1 {
		t.Fatalf("rejected creation persisted: %#v %v", page, err)
	}
}
