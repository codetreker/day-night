package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/api"
)

func testEnvironment(t *testing.T) map[string]string {
	t.Helper()
	url := os.Getenv("DAYNIGHT_TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("DAYNIGHT_TEST_DATABASE_URL is required for PostgreSQL tests")
	}
	return map[string]string{"DAYNIGHT_DATABASE_URL": url, "DAYNIGHT_LISTEN_ADDR": "127.0.0.1:0"}
}

func TestRunStartupFailures(t *testing.T) {
	for _, values := range []map[string]string{
		{},
		{"DAYNIGHT_DATABASE_URL": "postgres://user:top-secret@bad%host/db"},
		{"DAYNIGHT_DATABASE_URL": "postgres://user:top-secret@127.0.0.1:1/db?connect_timeout=1"},
		{"DAYNIGHT_DATABASE_URL": "postgres://top-secret", "DAYNIGHT_LISTEN_ADDR": "0.0.0.0:80"},
	} {
		var output bytes.Buffer
		if code := run(context.Background(), func(key string) string { return values[key] }, &output); code != 1 {
			t.Fatalf("startup failure returned %d", code)
		}
		if strings.Contains(output.String(), "top-secret") || !strings.Contains(output.String(), `"phase":"`) {
			t.Fatalf("unsafe or missing diagnostics: %s", &output)
		}
	}
	var output bytes.Buffer
	if code := run(context.Background(), func(string) string { return "" }, &output); code != 1 || !strings.Contains(output.String(), "DAYNIGHT_DATABASE_URL is required") {
		t.Fatalf("configuration error is not actionable: %s", &output)
	}
	values := testEnvironment(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	values["DAYNIGHT_LISTEN_ADDR"] = listener.Addr().String()
	if code := run(context.Background(), func(key string) string { return values[key] }, &output); code != 1 || !strings.Contains(output.String(), "HTTP listen failed") {
		t.Fatalf("occupied listener was not diagnosed: %s", &output)
	}
}

type stoppingWriter struct {
	bytes.Buffer
	once sync.Once
	stop context.CancelFunc
}

func (w *stoppingWriter) Write(value []byte) (int, error) {
	result, err := w.Buffer.Write(value)
	if bytes.Contains(value, []byte(`"phase":"listening"`)) {
		w.once.Do(w.stop)
	}
	return result, err
}

func TestRunStopsAfterStartup(t *testing.T) {
	values := testEnvironment(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	output := &stoppingWriter{stop: cancel}
	if code := run(ctx, func(key string) string { return values[key] }, output); code != 0 || !strings.Contains(output.String(), `"phase":"stopped"`) {
		t.Fatalf("clean shutdown returned %d: %s", code, output.String())
	}
}

func TestMainUsesProcessConfigurationAndExitCode(t *testing.T) {
	t.Setenv("DAYNIGHT_DATABASE_URL", "")
	previous := exit
	defer func() { exit = previous }()
	code := -1
	exit = func(value int) { code = value }
	main()
	if code != 1 {
		t.Fatalf("process exit code %d", code)
	}
}

type startupWriter struct {
	mu      sync.Mutex
	output  bytes.Buffer
	started chan string
}

func (w *startupWriter) Write(value []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	result, err := w.output.Write(value)
	var event struct {
		Phase   string `json:"phase"`
		Address string `json:"address"`
	}
	if json.Unmarshal(value, &event) == nil && event.Phase == "listening" {
		w.started <- event.Address
	}
	return result, err
}

func TestRunServesProjectAPI(t *testing.T) {
	values := testEnvironment(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	output := &startupWriter{started: make(chan string, 1)}
	finished := make(chan int, 1)
	go func() { finished <- run(ctx, func(key string) string { return values[key] }, output) }()
	var address string
	select {
	case address = <-output.started:
	case code := <-finished:
		t.Fatalf("process failed during startup: %d", code)
	case <-time.After(5 * time.Second):
		t.Fatal("server did not start")
	}
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get("http://" + address + "/api/v1/projects")
	if err != nil {
		t.Fatal(err)
	}
	var page api.ProjectPage
	err = json.NewDecoder(response.Body).Decode(&page)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusOK || page.Items == nil || response.Header.Get("X-Request-ID") == "" {
		t.Fatalf("project API was not wired: %d %+v %v", response.StatusCode, page, err)
	}
	response, err = client.Post("http://"+address+"/api/v1/projects", "application/json", strings.NewReader(`{"name":null}`))
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(response.Body)
	response.Body.Close()
	if err != nil || response.StatusCode != http.StatusBadRequest || !bytes.Contains(body, []byte(`"code":"invalid_input"`)) {
		t.Fatalf("project create route was not wired: %d %s %v", response.StatusCode, body, err)
	}
	cancel()
	select {
	case code := <-finished:
		if code != 0 {
			t.Fatalf("process did not stop cleanly: %d", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not stop")
	}
}
