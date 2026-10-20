package webui

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"path"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
)

func TestBundledPageAndReferencedAssets(t *testing.T) {
	ui := New()
	index, err := fs.ReadFile(bundled, "dist/index.html")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(index, []byte(`<div id="root"></div>`)) || bytes.Contains(index, []byte("/src/main.tsx")) {
		t.Fatal("embedded page is not the production frontend")
	}
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		response := httptest.NewRecorder()
		if err := ui.Page(response, httptest.NewRequest(method, "/", nil)); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "text/html; charset=utf-8" ||
			response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Content-Length") != strconv.Itoa(len(index)) ||
			method == http.MethodGet && !bytes.Equal(response.Body.Bytes(), index) || method == http.MethodHead && response.Body.Len() != 0 {
			t.Fatalf("page response differs from embedded artifact: %d %+v", response.Code, response.Header())
		}
	}
	assets := regexp.MustCompile(`(?:src|href)="(/assets/[^"?#]+)"`).FindAllStringSubmatch(string(index), -1)
	if len(assets) < 2 {
		t.Fatal("production index does not reference emitted script and stylesheet")
	}
	for _, reference := range assets {
		assetPath := reference[1]
		expected, err := fs.ReadFile(bundled, "dist"+assetPath)
		if err != nil {
			t.Fatal(err)
		}
		for _, method := range []string{http.MethodGet, http.MethodHead} {
			response := httptest.NewRecorder()
			if err := ui.Asset(response, httptest.NewRequest(method, assetPath, nil)); err != nil {
				t.Fatal(err)
			}
			if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" ||
				response.Header().Get("Content-Length") != strconv.Itoa(len(expected)) ||
				method == http.MethodGet && !bytes.Equal(response.Body.Bytes(), expected) || method == http.MethodHead && response.Body.Len() != 0 {
				t.Fatalf("asset %s differs from production artifact: %d %+v", assetPath, response.Code, response.Header())
			}
			contentType := response.Header().Get("Content-Type")
			if path.Ext(assetPath) == ".js" && !strings.HasPrefix(contentType, "text/javascript") ||
				path.Ext(assetPath) == ".css" && !strings.HasPrefix(contentType, "text/css") {
				t.Fatalf("incorrect asset MIME: %s %s", assetPath, contentType)
			}
		}
	}
}

func TestAssetsRejectDirectoriesMissingAndTraversal(t *testing.T) {
	ui := New()
	for _, target := range []string{"/assets/", "/assets/.", "/assets/..", "/assets/../index.html", "/assets//index.js", "/assets/missing.js", "/index.html", "/assets/%2e%2e/index.html", "/assets/nested/../../index.html"} {
		t.Run(target, func(t *testing.T) {
			response := httptest.NewRecorder()
			if err := ui.Asset(response, httptest.NewRequest(http.MethodGet, target, nil)); !errors.Is(err, ErrNotFound) {
				t.Fatalf("asset traversal/directory/missing result: %v", err)
			}
			if response.Body.Len() != 0 || len(response.Header()) != 0 {
				t.Fatal("invalid asset wrote a response")
			}
		})
	}
	files := fstest.MapFS{"dist/assets/folder/file.txt": &fstest.MapFile{Data: []byte("content")}}
	ui = &UI{files: files}
	response := httptest.NewRecorder()
	if err := ui.Asset(response, httptest.NewRequest(http.MethodGet, "/assets/folder", nil)); !errors.Is(err, ErrNotFound) {
		t.Fatalf("directory asset must not be listed: %v", err)
	}
}

func TestUnhashedAssetsAndUnknownExtension(t *testing.T) {
	ui := &UI{files: fstest.MapFS{"dist/assets/plain.txt": &fstest.MapFile{Data: []byte("ordinary asset")},
		"dist/assets/font.daynightbinary": &fstest.MapFile{Data: []byte{0, 1, 2, 3}}}}
	for _, name := range []string{"plain.txt", "font.daynightbinary"} {
		response := httptest.NewRecorder()
		if err := ui.Asset(response, httptest.NewRequest(http.MethodGet, "/assets/"+name, nil)); err != nil {
			t.Fatal(err)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("unhashed asset cannot be cached as immutable")
		}
		if name == "plain.txt" && response.Header().Get("Content-Type") != "text/plain; charset=utf-8" ||
			name == "font.daynightbinary" && response.Header().Get("Content-Type") != "application/octet-stream" {
			t.Fatalf("incorrect asset MIME detection: %+v", response.Header())
		}
	}
}

type resourceFailureFS struct {
	openErr, statErr, readErr, closeErr error
	cancel                              context.CancelFunc
}

func (f resourceFailureFS) Open(string) (fs.File, error) {
	if f.openErr != nil {
		return nil, f.openErr
	}
	file, err := (fstest.MapFS{"file": &fstest.MapFile{Data: []byte("resource")}}).Open("file")
	return &resourceFailureFile{File: file, failure: f}, err
}

type resourceFailureFile struct {
	fs.File
	failure resourceFailureFS
}

func (f *resourceFailureFile) Stat() (fs.FileInfo, error) {
	if f.failure.statErr != nil {
		return nil, f.failure.statErr
	}
	return f.File.Stat()
}

func (f *resourceFailureFile) Read(data []byte) (int, error) {
	if f.failure.cancel != nil {
		f.failure.cancel()
	}
	if f.failure.readErr != nil {
		return 0, f.failure.readErr
	}
	return f.File.Read(data)
}

func (f *resourceFailureFile) Close() error {
	return errors.Join(f.File.Close(), f.failure.closeErr)
}

func TestResourceIOErrorsPreserveCausesBeforeResponse(t *testing.T) {
	cause := errors.New("private-resource-path")
	for _, files := range []resourceFailureFS{{openErr: cause}, {statErr: cause}, {readErr: cause}, {closeErr: cause}, {statErr: cause, closeErr: io.ErrClosedPipe}} {
		ui := &UI{files: files}
		response := httptest.NewRecorder()
		err := ui.Page(response, httptest.NewRequest(http.MethodGet, "/", nil))
		if !errors.Is(err, cause) || response.Body.Len() != 0 || len(response.Header()) != 0 {
			t.Fatalf("resource IO failure lost its cause or wrote partial response: %v %+v", err, response)
		}
		if files.closeErr != nil && !errors.Is(err, files.closeErr) {
			t.Fatalf("resource close failure lost its cause: %v", err)
		}
	}
}

type failedWriter struct {
	header  http.Header
	partial bool
}

func (w *failedWriter) Header() http.Header { return w.header }
func (*failedWriter) WriteHeader(int)       {}
func (w *failedWriter) Write(data []byte) (int, error) {
	if w.partial {
		return len(data) - 1, nil
	}
	return 0, io.ErrClosedPipe
}

func TestResponseWriteFailuresAndCancellation(t *testing.T) {
	for _, partial := range []bool{false, true} {
		ui := New()
		writer := &failedWriter{header: make(http.Header), partial: partial}
		err := ui.Page(writer, httptest.NewRequest(http.MethodGet, "/", nil))
		var responseError *ResponseError
		cause := io.ErrClosedPipe
		if partial {
			cause = io.ErrShortWrite
		}
		if !errors.As(err, &responseError) || !errors.Is(err, cause) || err.Error() != "web response failed" {
			t.Fatalf("write failure lost phase or cause: %v", err)
		}
	}
	for _, duringRead := range []bool{false, true} {
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		ui := New()
		if duringRead {
			ui = &UI{files: resourceFailureFS{cancel: cancel}}
		} else {
			cancel()
		}
		response := httptest.NewRecorder()
		err := ui.Page(response, httptest.NewRequest(http.MethodGet, "/", nil).WithContext(ctx))
		if !errors.Is(err, context.Canceled) || response.Body.Len() != 0 || len(response.Header()) != 0 {
			t.Fatalf("canceled request wrote a response: %v %+v", err, response)
		}
	}
}
