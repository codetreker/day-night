package server

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/codetreker/daynight/packages/daynight-server/internal/core/store"
)

func testConfig(t *testing.T) Config {
	t.Helper()
	url := os.Getenv("DAYNIGHT_TEST_DATABASE_URL")
	if url == "" {
		t.Fatal("DAYNIGHT_TEST_DATABASE_URL is required for PostgreSQL tests")
	}
	return Config{DatabaseURL: url, ListenAddress: "127.0.0.1:0", StartupTimeout: 5 * time.Second, ShutdownTimeout: time.Second}
}

func testLogger() *slog.Logger { return slog.New(slog.NewJSONHandler(io.Discard, nil)) }

func await[T any](t *testing.T, channel <-chan T) T {
	t.Helper()
	select {
	case result := <-channel:
		return result
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for operation")
		var zero T
		return zero
	}
}

func TestStartupFailures(t *testing.T) {
	config := testConfig(t)
	invalid := config
	invalid.ListenAddress = "0.0.0.0:80"
	if _, err := Start(context.Background(), invalid, testLogger(), nil); err == nil {
		t.Fatal("accepted non-loopback listener")
	}
	invalid = config
	invalid.DatabaseURL = "postgres://secret:password@bad%host/database"
	if _, err := Start(context.Background(), invalid, testLogger(), nil); err == nil {
		t.Fatal("accepted malformed database configuration")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Start(ctx, config, testLogger(), nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled startup lost cause: %v", err)
	}
	listener, err := net.Listen("tcp", config.ListenAddress)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	config.ListenAddress = listener.Addr().String()
	_, err = Start(context.Background(), config, testLogger(), nil)
	var failure *runtimeError
	if !errors.As(err, &failure) || failure.phase != "listen" || errors.Unwrap(err) == nil {
		t.Fatalf("listener failure lost cause: %v", err)
	}
}

func TestGracefulDrainPreservesActiveRequestsAndReleasesResources(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	canceled := make(chan bool, 1)
	runtime, err := Start(context.Background(), testConfig(t), testLogger(), func(database *store.Store) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			close(entered)
			select {
			case <-r.Context().Done():
				canceled <- true
			case <-release:
				canceled <- false
				if err := database.Pool.Ping(r.Context()); err != nil {
					t.Error(err)
				}
				_, _ = io.WriteString(w, "complete")
			}
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- runtime.Run(ctx) }()
	response := make(chan error, 1)
	go func() {
		res, err := (&http.Client{Timeout: 4 * time.Second}).Get("http://" + runtime.Address())
		if err == nil {
			defer res.Body.Close()
			var body []byte
			body, err = io.ReadAll(res.Body)
			if string(body) != "complete" {
				err = errors.New("request did not finish")
			}
		}
		response <- err
	}()
	await(t, entered)
	cancel()
	select {
	case <-canceled:
		t.Fatal("shutdown canceled active request before drain deadline")
	case <-time.After(30 * time.Millisecond):
	}
	close(release)
	if await(t, canceled) {
		t.Fatal("active request canceled")
	}
	if err := await(t, response); err != nil {
		t.Fatal(err)
	}
	if err := await(t, result); err != nil {
		t.Fatal(err)
	}
	if _, err := runtime.Store.Pool.Acquire(context.Background()); err == nil {
		t.Fatal("database pool remained open")
	}
	listener, err := net.Listen("tcp", runtime.Address())
	if err != nil {
		t.Fatalf("listener leaked: %v", err)
	}
	listener.Close()
}

func TestForcedDrainCancelsDatabaseWork(t *testing.T) {
	config := testConfig(t)
	config.ShutdownTimeout = 30 * time.Millisecond
	entered := make(chan struct{})
	queryResult := make(chan error, 1)
	runtime, err := Start(context.Background(), config, testLogger(), func(database *store.Store) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			connection, err := database.Pool.Acquire(r.Context())
			if err != nil {
				queryResult <- err
				return
			}
			defer connection.Release()
			close(entered)
			_, err = connection.Exec(r.Context(), "select pg_sleep(10)")
			queryResult <- err
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() { result <- runtime.Run(ctx) }()
	clientDone := make(chan struct{})
	go func() {
		defer close(clientDone)
		response, err := (&http.Client{Timeout: 4 * time.Second}).Get("http://" + runtime.Address())
		if err == nil {
			response.Body.Close()
		}
	}()
	await(t, entered)
	start := time.Now()
	cancel()
	if err := await(t, result); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("missing bounded shutdown failure: %v", err)
	}
	if time.Since(start) > time.Second {
		t.Fatal("shutdown exceeded bound")
	}
	if err := await(t, queryResult); !errors.Is(err, context.Canceled) {
		t.Fatalf("request did not cancel query: %v", err)
	}
	await(t, clientDone)
}

func TestClientCancellationReachesDatabase(t *testing.T) {
	entered, queryResult := make(chan struct{}), make(chan error, 1)
	runtime, err := Start(context.Background(), testConfig(t), testLogger(), func(database *store.Store) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			close(entered)
			_, err := database.Pool.Exec(r.Context(), "select pg_sleep(10)")
			queryResult <- err
		})
	})
	if err != nil {
		t.Fatal(err)
	}
	root, stop := context.WithCancel(context.Background())
	defer stop()
	result := make(chan error, 1)
	go func() { result <- runtime.Run(root) }()
	ctx, cancel := context.WithCancel(context.Background())
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+runtime.Address(), nil)
	if err != nil {
		t.Fatal(err)
	}
	response := make(chan error, 1)
	go func() {
		res, err := (&http.Client{Timeout: 4 * time.Second}).Do(request)
		if err == nil {
			res.Body.Close()
		}
		response <- err
	}()
	await(t, entered)
	cancel()
	if err := await(t, response); !errors.Is(err, context.Canceled) {
		t.Fatalf("client cancellation failed: %v", err)
	}
	if err := await(t, queryResult); !errors.Is(err, context.Canceled) {
		t.Fatalf("query cancellation failed: %v", err)
	}
	if err := runtime.Store.Pool.Ping(context.Background()); err != nil {
		t.Fatal(err)
	}
	stop()
	if err := await(t, result); err != nil {
		t.Fatal(err)
	}
}

func TestServeFailureAndAlreadyClosed(t *testing.T) {
	for _, closed := range []bool{false, true} {
		runtime, err := Start(context.Background(), testConfig(t), testLogger(), func(*store.Store) http.Handler { return http.NotFoundHandler() })
		if err != nil {
			t.Fatal(err)
		}
		if closed {
			runtime.http.Close()
		} else {
			runtime.listener.Close()
		}
		err = runtime.Run(context.Background())
		if closed && err != nil {
			t.Fatalf("normal server close: %v", err)
		}
		if !closed && !errors.Is(err, net.ErrClosed) {
			t.Fatalf("unexpected serve failure: %v", err)
		}
		if _, err := runtime.Store.Pool.Acquire(context.Background()); err == nil {
			t.Fatal("failed server leaked pool")
		}
	}
}
