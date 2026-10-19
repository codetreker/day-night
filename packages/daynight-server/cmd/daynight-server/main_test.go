package main

import (
	"bytes"
	"context"
	"net"
	"os"
	"strings"
	"sync"
	"testing"
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
