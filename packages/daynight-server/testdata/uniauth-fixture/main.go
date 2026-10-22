package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/codetreker/uniauth/internal/apps"
	"github.com/codetreker/uniauth/internal/auth"
	"github.com/codetreker/uniauth/internal/providers"
)

const githubClientID = "daynight-fixture-github"
const githubClientSecret = "daynight-fixture-github-secret"

type persona struct {
	id       int64
	name     *string
	email    *string
	avatar   *string
	verified *bool
}

func value[T any](v T) *T { return &v }

func identity(name string) (persona, error) {
	switch name {
	case "alice":
		return persona{101, value("Alice"), value("shared@example.test"), value("https://images.example.test/alice.png"), value(true)}, nil
	case "alice-updated":
		return persona{101, value("Alice Updated"), value("refreshed@example.test"), value("https://images.example.test/alice-updated.png"), value(false)}, nil
	case "alice-null":
		return persona{id: 101}, nil
	case "bob":
		return persona{202, value("Bob"), value("shared@example.test"), value("https://images.example.test/bob.png"), value(true)}, nil
	case "nullable":
		return persona{id: 303}, nil
	default:
		return persona{}, errors.New("unknown GitHub fixture persona")
	}
}

type githubTransport struct{ callback string }

// Only GitHub's external responses are controlled. UniAuth owns the transaction,
// browser binding, PKCE verifier, identity normalization, and one-time result.
func (transport githubTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if err := request.Context().Err(); err != nil {
		return nil, err
	}
	if request.URL.Scheme != "https" || request.URL.User != nil || request.URL.Fragment != "" {
		return nil, errors.New("unexpected GitHub fixture request")
	}
	if request.Method == http.MethodPost && request.URL.Host == "github.com" && request.URL.Path == "/login/oauth/access_token" && request.URL.RawQuery == "" {
		if err := request.ParseForm(); err != nil {
			return nil, fmt.Errorf("parse GitHub fixture token request: %w", err)
		}
		name, challenge, found := strings.Cut(request.PostForm.Get("code"), ":")
		if !found {
			return nil, errors.New("GitHub fixture authorization code requires its PKCE challenge")
		}
		if _, err := identity(name); err != nil {
			return nil, err
		}
		verifier := request.PostForm.Get("code_verifier")
		digest := sha256.Sum256([]byte(verifier))
		if len(verifier) < 43 || base64.RawURLEncoding.EncodeToString(digest[:]) != challenge {
			return nil, errors.New("GitHub fixture PKCE verification failed")
		}
		if request.PostForm.Get("client_id") != githubClientID || request.PostForm.Get("client_secret") != githubClientSecret || request.PostForm.Get("redirect_uri") != transport.callback || request.PostForm.Get("grant_type") != "authorization_code" {
			return nil, errors.New("GitHub fixture token request did not retain its configured client and callback")
		}
		return jsonResponse(request, map[string]any{"access_token": "fixture-" + name, "token_type": "Bearer"})
	}
	if request.Method != http.MethodGet || request.URL.Host != "api.github.com" {
		return nil, errors.New("unexpected GitHub fixture endpoint")
	}
	token, found := strings.CutPrefix(request.Header.Get("Authorization"), "Bearer fixture-")
	if !found {
		return nil, errors.New("GitHub fixture bearer token is required")
	}
	person, err := identity(token)
	if err != nil {
		return nil, err
	}
	switch request.URL.Path {
	case "/user":
		if request.URL.RawQuery != "" {
			return nil, errors.New("unexpected GitHub fixture profile query")
		}
		return jsonResponse(request, map[string]any{"id": person.id, "name": person.name, "email": person.email, "avatar_url": person.avatar, "fixture": map[string]any{"nullable": nil, "enabled": false}})
	case "/user/emails":
		query := request.URL.Query()
		if len(query) != 2 || query.Get("per_page") != "100" || query.Get("page") != "1" {
			return nil, errors.New("unexpected GitHub fixture email pagination")
		}
		if person.email == nil {
			return jsonResponse(request, []any{})
		}
		return jsonResponse(request, []any{map[string]any{"email": person.email, "primary": true, "verified": person.verified}})
	default:
		return nil, errors.New("unexpected GitHub fixture API endpoint")
	}
}

func jsonResponse(request *http.Request, data any) (*http.Response, error) {
	body, err := json.Marshal(data)
	if err != nil {
		return nil, err
	}
	return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(string(body))), ContentLength: int64(len(body)), Request: request}, nil
}

type readiness struct {
	Origin    string `json:"origin"`
	AppID     string `json:"appId"`
	AppSecret string `json:"appSecret"`
}

func writeReadiness(path string, ready readiness) (err error) {
	file, err := os.CreateTemp(filepath.Dir(path), ".uniauth-ready-*")
	if err != nil {
		return fmt.Errorf("create fixture readiness file: %w", err)
	}
	defer func() { err = errors.Join(err, removeFile(file.Name())) }()
	if err := file.Chmod(0o600); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := json.NewEncoder(file).Encode(ready); err != nil {
		return errors.Join(err, file.Close())
	}
	if err := file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func removeFile(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func run(ctx context.Context) (err error) {
	required := []string{"DAYNIGHT_FIXTURE_CALLBACK_URL", "DAYNIGHT_FIXTURE_DATABASE_PATH", "DAYNIGHT_FIXTURE_READY_FILE", "DAYNIGHT_FIXTURE_LISTEN_ADDRESS"}
	for _, name := range required {
		if os.Getenv(name) == "" {
			return fmt.Errorf("%s is required", name)
		}
	}
	host, _, err := net.SplitHostPort(os.Getenv("DAYNIGHT_FIXTURE_LISTEN_ADDRESS"))
	if err != nil || host != "127.0.0.1" && host != "0.0.0.0" {
		return errors.New("fixture listener must use 127.0.0.1 or an explicitly configured container wildcard")
	}
	listener, err := net.Listen("tcp", os.Getenv("DAYNIGHT_FIXTURE_LISTEN_ADDRESS"))
	if err != nil {
		return fmt.Errorf("bind fixture listener: %w", err)
	}
	defer listener.Close()
	origin := "http://" + listener.Addr().String()
	if configured := os.Getenv("DAYNIGHT_FIXTURE_PUBLIC_URL"); configured != "" {
		public, parseErr := url.Parse(configured)
		_, boundPort, _ := net.SplitHostPort(listener.Addr().String())
		if parseErr != nil || public.Scheme != "http" || public.Hostname() != "127.0.0.1" || public.Port() != boundPort || public.Path != "" || public.RawQuery != "" || public.Fragment != "" || public.User != nil {
			return errors.New("fixture public URL must be the exact numeric loopback HTTP origin using its bound port")
		}
		origin = configured
	} else if host != "127.0.0.1" {
		return errors.New("container fixture listener requires an explicit public URL")
	}
	startup, cancelStartup := context.WithTimeout(ctx, 10*time.Second)
	defer cancelStartup()
	store, err := apps.Open(startup, apps.Config{Path: os.Getenv("DAYNIGHT_FIXTURE_DATABASE_PATH")})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, store.Close()) }()
	if err := store.InitializePlatform(startup, "fixture-owner@example.test"); err != nil {
		return err
	}
	owner, err := store.ResolveAccount(startup, providers.Identity{Provider: "github", ID: "github:fixture-owner"})
	if err != nil {
		return err
	}
	app, err := store.Create(startup, owner.ID, apps.CreateAppInput{AppInput: apps.AppInput{Name: "Daynight integration fixture", Enabled: true, RedirectURIs: []string{os.Getenv("DAYNIGHT_FIXTURE_CALLBACK_URL")}, Providers: []string{"github"}}, InitialSecret: &apps.SecretInput{Name: "Daynight integration backend"}})
	if err != nil {
		return err
	}
	providerCallback := origin + "/auth/callback/github"
	github, err := providers.NewGitHub(providers.Config{ClientID: githubClientID, ClientSecret: githubClientSecret, RedirectURL: providerCallback, HTTPClient: &http.Client{Timeout: 3 * time.Second, Transport: githubTransport{callback: providerCallback}}})
	if err != nil {
		return err
	}
	handler, err := auth.New(ctx, auth.Config{PublicURL: origin, AllowLoopbackHTTP: true, TransactionTTL: 5 * time.Minute, CallbackTimeout: 5 * time.Second, CleanupInterval: time.Minute, MaxTransactions: 256, MaxTransactionBytes: 1 << 20, MaxResults: 256, MaxResultBytes: 1 << 20, Logger: slog.New(slog.NewTextHandler(os.Stderr, nil))}, store, map[string]providers.Provider{"github": github})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, handler.Close()) }()
	mux := http.NewServeMux()
	handler.Register(mux)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodPost && request.URL.Path == "/auth/result" {
			slog.Info("fixture result request", "type", "fixture_result_request")
		}
		mux.ServeHTTP(w, request)
	}), ReadHeaderTimeout: 3 * time.Second}
	defer func() { err = errors.Join(err, server.Close()) }()
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	readyFile := os.Getenv("DAYNIGHT_FIXTURE_READY_FILE")
	defer func() { err = errors.Join(err, removeFile(readyFile)) }()
	if err := writeReadiness(readyFile, readiness{Origin: origin, AppID: app.App.ID, AppSecret: app.Secret}); err != nil {
		return err
	}
	if err := json.NewEncoder(os.Stdout).Encode(map[string]string{"origin": origin}); err != nil {
		return err
	}
	select {
	case err := <-served:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-ctx.Done():
		shutdown, cancelShutdown := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancelShutdown()
		if err := server.Shutdown(shutdown); err != nil {
			return err
		}
		if err := <-served; !errors.Is(err, http.ErrServerClosed) {
			return err
		}
		return nil
	}
}

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	if err := run(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "UniAuth fixture:", err)
		os.Exit(1)
	}
}
