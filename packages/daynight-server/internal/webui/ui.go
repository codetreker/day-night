package webui

import (
	"embed"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// Both patterns must match real build output before this package can compile.
//
//go:embed dist/index.html dist/assets/*
var bundled embed.FS

var ErrNotFound = errors.New("web resource not found")

var hashedAsset = regexp.MustCompile(`-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9.]+$`)

type UI struct {
	files fs.FS
}

type ResponseError struct {
	Cause error
}

func (e *ResponseError) Error() string { return "web response failed" }
func (e *ResponseError) Unwrap() error { return e.Cause }

func New() *UI { return &UI{files: bundled} }

func (u *UI) Page(w http.ResponseWriter, request *http.Request) error {
	return u.serve(w, request, "dist/index.html", "text/html; charset=utf-8", "no-store")
}

func (u *UI) Asset(w http.ResponseWriter, request *http.Request) error {
	if !strings.HasPrefix(request.URL.Path, "/assets/") {
		return ErrNotFound
	}
	name := strings.TrimPrefix(request.URL.Path, "/assets/")
	if !fs.ValidPath(name) || name == "." {
		return ErrNotFound
	}
	cache := "no-store"
	if hashedAsset.MatchString(path.Base(name)) {
		cache = "public, max-age=31536000, immutable"
	}
	return u.serve(w, request, "dist/assets/"+name, mime.TypeByExtension(path.Ext(name)), cache)
}

func (u *UI) read(name string) ([]byte, error) {
	file, err := u.files.Open(name)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, fmt.Errorf("%w: %w", ErrNotFound, err)
		}
		return nil, err
	}
	info, statErr := file.Stat()
	var data []byte
	var readErr error
	if statErr == nil && !info.IsDir() {
		data, readErr = io.ReadAll(file)
	}
	if err := errors.Join(statErr, readErr, file.Close()); err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, ErrNotFound
	}
	return data, nil
}

func (u *UI) serve(w http.ResponseWriter, request *http.Request, name, contentType, cache string) error {
	if err := request.Context().Err(); err != nil {
		return err
	}
	data, err := u.read(name)
	if err != nil {
		return err
	}
	if err := request.Context().Err(); err != nil {
		return err
	}
	if contentType == "" {
		contentType = http.DetectContentType(data)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Cache-Control", cache)
	w.WriteHeader(http.StatusOK)
	if request.Method == http.MethodHead {
		return nil
	}
	written, err := w.Write(data)
	if err == nil && written != len(data) {
		err = io.ErrShortWrite
	}
	if err != nil {
		return &ResponseError{Cause: err}
	}
	return nil
}
