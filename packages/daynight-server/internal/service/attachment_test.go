package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core"
	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
	"github.com/codetreker/daynight/packages/daynight-server/internal/filestorage"
	"github.com/codetreker/daynight/packages/daynight-server/internal/filestorage/local"
)

func attachmentService(t *testing.T) (*Attachments, *Tasks, *store.Store, *local.Storage, core.Task) {
	t.Helper()
	tasks, database, project, _ := taskService(t)
	files, err := local.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := files.Close(); err != nil {
			t.Error(err)
		}
	})
	return NewAttachments(database, files), tasks, database, files, createTask(t, tasks, project.ID, "Attachments")
}

func putAttachment(t *testing.T, attachments *Attachments, task core.Task, path, content string) core.Attachment {
	t.Helper()
	attachment, _, err := attachments.Put(context.Background(), task.ProjectID, task.ID, path, "text/plain; charset=utf-8", strings.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	return attachment
}

func TestAttachmentLifecycleAndTaskIndependence(t *testing.T) {
	attachments, tasks, _, files, task := attachmentService(t)
	ctx := context.Background()
	prerequisite := createTask(t, tasks, task.ProjectID, "Prerequisite")
	task = updateTask(t, tasks, task, UpdateTask{DependsOn: pointer([]string{prerequisite.ID}), Properties: core.TaskPropertiesPatch{
		PullRequests: pointer([]core.PullRequestProperty{{URL: "https://github.com/example/repository/pull/1"}}),
	}})
	empty, err := attachments.List(ctx, task.ProjectID, task.ID, PageRequest{Limit: 50})
	if err != nil || empty.Items == nil || len(empty.Items) != 0 || empty.NextCursor != nil {
		t.Fatalf("empty page: %#v, %v", empty, err)
	}
	content := []byte{0, 1, 255, '\n', 'a'}
	first, created, err := attachments.Put(ctx, strings.ToUpper(task.ProjectID), strings.ToUpper(task.ID), "设计 文档/a%_?#.bin", "application/octet-stream", bytes.NewReader(content))
	if err != nil || !created || first.ProjectID != task.ProjectID || first.TaskID != task.ID || first.SizeBytes != int64(len(content)) ||
		first.Path != "设计 文档/a%_?#.bin" || first.ContentType != "application/octet-stream" || first.CreatedAt.IsZero() || !first.CreatedAt.Equal(first.UpdatedAt) {
		t.Fatalf("new attachment: %#v, created=%v, %v", first, created, err)
	}
	metadata, object, err := attachments.Open(ctx, task.ProjectID, task.ID, first.Path)
	if err != nil {
		t.Fatal(err)
	}
	got, readErr := io.ReadAll(object.Body)
	closeErr := object.Body.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(got, content) || object.Info.Size != first.SizeBytes || !reflect.DeepEqual(metadata, first) {
		t.Fatalf("binary read: %v %#v %v %v", got, metadata, readErr, closeErr)
	}
	second, created, err := attachments.Put(ctx, task.ProjectID, task.ID, first.Path, "text/plain; charset=utf-8", strings.NewReader("replacement"))
	if err != nil || created || !second.CreatedAt.Equal(first.CreatedAt) || !second.UpdatedAt.After(first.UpdatedAt) || second.SizeBytes != 11 || second.ContentType != "text/plain; charset=utf-8" {
		t.Fatalf("overwrite: %#v, created=%v, %v", second, created, err)
	}
	putAttachment(t, attachments, task, "other/a%_?#.bin", "other")
	zero := putAttachment(t, attachments, task, "empty", "")
	if zero.SizeBytes != 0 {
		t.Fatalf("empty size: %d", zero.SizeBytes)
	}
	if _, err := files.Put(ctx, attachmentBucket, task.ID+"/"+first.Path, strings.NewReader("different physical length")); err != nil {
		t.Fatal(err)
	}
	metadata, object, err = attachments.Open(ctx, task.ProjectID, task.ID, first.Path)
	if err != nil || object.Info.Size != 25 || metadata.SizeBytes != 11 {
		t.Fatalf("opened length must be actual: %#v %#v %v", metadata, object.Info, err)
	}
	if err := object.Body.Close(); err != nil {
		t.Fatal(err)
	}
	if err := attachments.Delete(ctx, task.ProjectID, task.ID, first.Path); err != nil {
		t.Fatal(err)
	}
	_, _, err = attachments.Open(ctx, task.ProjectID, task.ID, first.Path)
	requireFault(t, err, "not_found")
	requireFault(t, attachments.Delete(ctx, task.ProjectID, task.ID, first.Path), "not_found")
	rebuilt := putAttachment(t, attachments, task, first.Path, "rebuilt")
	if !rebuilt.CreatedAt.After(first.CreatedAt) || !rebuilt.CreatedAt.Equal(rebuilt.UpdatedAt) {
		t.Fatalf("recreated timestamps: %#v", rebuilt)
	}
	assertTaskUnchanged(t, tasks, task)
}

func TestAttachmentScopeAndPathConflicts(t *testing.T) {
	attachments, tasks, database, _, task := attachmentService(t)
	ctx := context.Background()
	otherProject, err := NewProjects(database).Create(ctx, CreateProject{Name: "Other", RepoURL: "host:other"})
	if err != nil {
		t.Fatal(err)
	}
	other := createTask(t, tasks, otherProject.ID, "Other")
	putAttachment(t, attachments, task, "docs", "file")
	putAttachment(t, attachments, task, "literal%_/child", "nested")
	putAttachment(t, attachments, task, "literalXX/child", "different")
	putAttachment(t, attachments, task, "Case", "upper")
	putAttachment(t, attachments, task, "case", "lower")
	for _, path := range []string{"docs/child", "literal%_"} {
		_, _, err := attachments.Put(ctx, task.ProjectID, task.ID, path, "text/plain", strings.NewReader("conflict"))
		requireFault(t, err, "path_conflict")
	}
	// Wildcards are ordinary filename characters in both prefix directions.
	putAttachment(t, attachments, task, "literal%", "literal percent")
	putAttachment(t, attachments, task, "literal_/file", "literal underscore")
	missing := "00000000-0000-0000-0000-000000000000"
	for _, scope := range [][2]string{{missing, task.ID}, {task.ProjectID, missing}, {task.ProjectID, other.ID}, {otherProject.ID, task.ID}} {
		projectID, taskID := scope[0], scope[1]
		_, err := attachments.List(ctx, projectID, taskID, PageRequest{Limit: 10})
		requireFault(t, err, "not_found")
		_, _, err = attachments.Put(ctx, projectID, taskID, "file", "text/plain", strings.NewReader("no"))
		requireFault(t, err, "not_found")
		_, _, err = attachments.Open(ctx, projectID, taskID, "docs")
		requireFault(t, err, "not_found")
		requireFault(t, attachments.Delete(ctx, projectID, taskID, "docs"), "not_found")
	}
	_, _, err = attachments.Open(ctx, task.ProjectID, task.ID, "missing")
	requireFault(t, err, "not_found")
	assertTaskUnchanged(t, tasks, task)
}

func TestAttachmentValidation(t *testing.T) {
	attachments := NewAttachments(nil, nil)
	id := "00000000-0000-0000-0000-000000000001"
	for _, address := range [][3]string{{"invalid", id, "file"}, {id, "invalid", "file"}, {id, id, ""}, {id, id, "/file"},
		{id, id, "a//b"}, {id, id, "a/../b"}, {id, id, "a/./b"}, {id, id, "a\\b"}, {id, id, "a\x00b"}, {id, id, "\xff"}, {id, id, "C:/file"}} {
		_, _, err := attachments.Put(context.Background(), address[0], address[1], address[2], "text/plain", strings.NewReader(""))
		requireFault(t, err, "invalid_input")
		_, _, err = attachments.Open(context.Background(), address[0], address[1], address[2])
		requireFault(t, err, "invalid_input")
		requireFault(t, attachments.Delete(context.Background(), address[0], address[1], address[2]), "invalid_input")
	}
	for _, contentType := range []string{"", "broken", "text/plain; charset", "text/plain\r\nInjected: yes"} {
		_, _, err := attachments.Put(context.Background(), id, id, "file", contentType, strings.NewReader(""))
		requireFault(t, err, "invalid_input")
	}
	for _, scope := range [][2]string{{"bad", id}, {id, "bad"}} {
		_, err := attachments.List(context.Background(), scope[0], scope[1], PageRequest{Limit: 1})
		requireFault(t, err, "invalid_input")
	}
}

func TestAttachmentPaginationAndCursorScope(t *testing.T) {
	attachments, tasks, _, _, task := attachmentService(t)
	ctx := context.Background()
	want := []string{"a/file", "A/file", "中 文", "emoji-😀", "%literal", "_literal"}
	for _, path := range want {
		putAttachment(t, attachments, task, path, path)
	}
	slices.Sort(want)
	request := PageRequest{Limit: 2}
	var got []string
	var firstCursor *string
	for {
		page, err := attachments.List(ctx, strings.ToUpper(task.ProjectID), strings.ToUpper(task.ID), request)
		if err != nil {
			t.Fatal(err)
		}
		for _, attachment := range page.Items {
			got = append(got, attachment.Path)
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
		t.Fatalf("path pages: %v, want %v", got, want)
	}
	other := createTask(t, tasks, task.ProjectID, "Other")
	_, err := attachments.List(ctx, task.ProjectID, other.ID, PageRequest{Limit: 2, Cursor: firstCursor})
	requireFault(t, err, "invalid_input")
	data, err := base64.RawURLEncoding.DecodeString(*firstCursor)
	if err != nil {
		t.Fatal(err)
	}
	var valid attachmentCursor
	if err := json.Unmarshal(data, &valid); err != nil {
		t.Fatal(err)
	}
	invalid := []string{"", "not-base64", base64.RawURLEncoding.EncodeToString([]byte("{")), base64.RawURLEncoding.EncodeToString(append(data, []byte(" true")...)),
		base64.RawURLEncoding.EncodeToString([]byte(strings.Replace(string(data), `"version":1`, `"unknown":1,"version":1`, 1)))}
	for _, change := range []func(*attachmentCursor){
		func(c *attachmentCursor) { c.Version = 2 }, func(c *attachmentCursor) { c.Kind = "tasks" },
		func(c *attachmentCursor) { c.ProjectID = other.ID }, func(c *attachmentCursor) { c.TaskID = other.ID },
		func(c *attachmentCursor) { c.Path = "../bad" },
	} {
		cursor := valid
		change(&cursor)
		data, err := json.Marshal(cursor)
		if err != nil {
			t.Fatal(err)
		}
		invalid = append(invalid, base64.RawURLEncoding.EncodeToString(data))
	}
	for _, cursor := range invalid {
		_, err := attachments.List(ctx, task.ProjectID, task.ID, PageRequest{Limit: 2, Cursor: &cursor})
		requireFault(t, err, "invalid_input")
	}
	for _, limit := range []int{0, -1, 101} {
		_, err := attachments.List(ctx, task.ProjectID, task.ID, PageRequest{Limit: limit})
		requireFault(t, err, "invalid_input")
	}
}

type attachmentFaultStorage struct {
	filestorage.Storage
	put         error
	open        error
	delete      error
	afterPut    func()
	afterDelete func()
}

func (s attachmentFaultStorage) Put(ctx context.Context, bucket, path string, content io.Reader) (filestorage.FileInfo, error) {
	if s.put != nil {
		return filestorage.FileInfo{}, s.put
	}
	info, err := s.Storage.Put(ctx, bucket, path, content)
	if err == nil && s.afterPut != nil {
		s.afterPut()
	}
	return info, err
}

func (s attachmentFaultStorage) Open(ctx context.Context, bucket, path string) (filestorage.Object, error) {
	if s.open != nil {
		return filestorage.Object{}, s.open
	}
	return s.Storage.Open(ctx, bucket, path)
}

func (s attachmentFaultStorage) Delete(ctx context.Context, bucket, path string) error {
	if s.delete != nil {
		return s.delete
	}
	err := s.Storage.Delete(ctx, bucket, path)
	if err == nil && s.afterDelete != nil {
		s.afterDelete()
	}
	return err
}

func assertAttachmentOperationalError(t *testing.T, err, cause error) {
	t.Helper()
	var fault *Fault
	if !errors.Is(err, cause) || errors.As(err, &fault) {
		t.Fatalf("operational error lost cause or became business fault: %v", err)
	}
}

func TestAttachmentStorageFailuresAndMissingPhysicalFile(t *testing.T) {
	attachments, _, database, files, task := attachmentService(t)
	ctx := context.Background()
	putAttachment(t, attachments, task, "file", "content")
	sentinel := errors.New("disk failed")
	failed := NewAttachments(database, attachmentFaultStorage{Storage: files, put: sentinel, open: sentinel, delete: sentinel})
	_, _, err := failed.Put(ctx, task.ProjectID, task.ID, "file", "text/plain", strings.NewReader("new"))
	assertAttachmentOperationalError(t, err, sentinel)
	_, _, err = failed.Open(ctx, task.ProjectID, task.ID, "file")
	assertAttachmentOperationalError(t, err, sentinel)
	assertAttachmentOperationalError(t, failed.Delete(ctx, task.ProjectID, task.ID, "file"), sentinel)
	if err := files.Delete(ctx, attachmentBucket, task.ID+"/file"); err != nil {
		t.Fatal(err)
	}
	_, _, err = attachments.Open(ctx, task.ProjectID, task.ID, "file")
	assertAttachmentOperationalError(t, err, fs.ErrNotExist)
	if err := attachments.Delete(ctx, task.ProjectID, task.ID, "file"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(ctx)
	cancel()
	_, _, err = attachments.Put(ctx, task.ProjectID, task.ID, "cancelled", "text/plain", strings.NewReader(""))
	assertAttachmentOperationalError(t, err, context.Canceled)
}

func TestAttachmentDatabaseFailures(t *testing.T) {
	attachments, _, database, _, task := attachmentService(t)
	ctx := context.Background()
	putAttachment(t, attachments, task, "file", "content")
	if _, err := database.Pool.Exec(ctx, `DROP TABLE task_attachments`); err != nil {
		t.Fatal(err)
	}
	for _, operation := range []func() error{
		func() error {
			_, err := attachments.List(ctx, task.ProjectID, task.ID, PageRequest{Limit: 1})
			return err
		},
		func() error { _, _, err := attachments.Open(ctx, task.ProjectID, task.ID, "file"); return err },
		func() error {
			_, _, err := attachments.Put(ctx, task.ProjectID, task.ID, "new", "text/plain", strings.NewReader(""))
			return err
		},
		func() error { return attachments.Delete(ctx, task.ProjectID, task.ID, "file") },
	} {
		var databaseError *store.Error
		var fault *Fault
		err := operation()
		if !errors.As(err, &databaseError) || errors.As(err, &fault) {
			t.Fatalf("database failure: %v", err)
		}
	}
	database.Close()
	_, err := attachments.List(ctx, task.ProjectID, task.ID, PageRequest{Limit: 1})
	if err == nil {
		t.Fatal("closed database read succeeded")
	}
}

func TestAttachmentMetadataFailuresAfterStorageOperation(t *testing.T) {
	for _, operation := range []string{"put", "delete", "concurrent delete"} {
		t.Run(operation, func(t *testing.T) {
			attachments, _, database, files, task := attachmentService(t)
			ctx := context.Background()
			putAttachment(t, attachments, task, "file", "before")
			removeTable := func() {
				if _, err := database.Pool.Exec(ctx, `DROP TABLE task_attachments`); err != nil {
					t.Fatal(err)
				}
			}
			faults := attachmentFaultStorage{Storage: files}
			if operation == "put" {
				faults.afterPut = removeTable
				_, _, err := NewAttachments(database, faults).Put(ctx, task.ProjectID, task.ID, "file", "text/plain", strings.NewReader("after"))
				var databaseError *store.Error
				if !errors.As(err, &databaseError) {
					t.Fatalf("metadata write error: %v", err)
				}
				object, err := files.Open(ctx, attachmentBucket, task.ID+"/file")
				if err != nil {
					t.Fatal(err)
				}
				content, readErr := io.ReadAll(object.Body)
				closeErr := object.Body.Close()
				if readErr != nil || closeErr != nil || string(content) != "after" {
					t.Fatalf("successful file write was hidden: %q, %v, %v", content, readErr, closeErr)
				}
				return
			}
			if operation == "delete" {
				faults.afterDelete = removeTable
			} else {
				faults.afterDelete = func() {
					if err := database.DeleteAttachment(ctx, task.ProjectID, task.ID, "file"); err != nil {
						t.Fatal(err)
					}
				}
			}
			err := NewAttachments(database, faults).Delete(ctx, task.ProjectID, task.ID, "file")
			if operation == "concurrent delete" {
				requireFault(t, err, "not_found")
			} else {
				var databaseError *store.Error
				if !errors.As(err, &databaseError) {
					t.Fatalf("metadata delete error: %v", err)
				}
			}
			_, err = files.Open(ctx, attachmentBucket, task.ID+"/file")
			if !errors.Is(err, fs.ErrNotExist) {
				t.Fatalf("successful file deletion was hidden: %v", err)
			}
		})
	}
}
