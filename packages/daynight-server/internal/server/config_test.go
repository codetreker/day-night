package server

import (
	"strings"
	"testing"
	"time"
)

func TestLoadConfig(t *testing.T) {
	config, err := LoadConfig(func(key string) string {
		if key == "DAYNIGHT_DATABASE_URL" {
			return "postgres://database"
		}
		return ""
	})
	if err != nil || config.ListenAddress != "127.0.0.1:8787" || config.StartupTimeout != 10*time.Second || config.ShutdownTimeout != 10*time.Second {
		t.Fatalf("unexpected defaults: %+v, %v", config, err)
	}
	config, err = LoadConfig(func(key string) string {
		return map[string]string{"DAYNIGHT_DATABASE_URL": "postgres://database", "DAYNIGHT_LISTEN_ADDR": "[::1]:0"}[key]
	})
	if err != nil || config.ListenAddress != "[::1]:0" {
		t.Fatalf("IPv6 loopback rejected: %+v, %v", config, err)
	}
}

func TestConfigRejectsInvalidInputs(t *testing.T) {
	for _, field := range []string{"DAYNIGHT_STARTUP_TIMEOUT", "DAYNIGHT_SHUTDOWN_TIMEOUT"} {
		for _, value := range []string{"-1s", "0s", "password", "1"} {
			_, err := LoadConfig(func(key string) string {
				if key == field {
					return value
				}
				return ""
			})
			if err == nil || !strings.Contains(err.Error(), field) || strings.Contains(err.Error(), value) {
				t.Fatalf("invalid duration not safely diagnosed: %v", err)
			}
		}
	}
	config, err := LoadConfig(func(key string) string {
		return map[string]string{
			"DAYNIGHT_DATABASE_URL": "postgres://db", "DAYNIGHT_STARTUP_TIMEOUT": "2s", "DAYNIGHT_SHUTDOWN_TIMEOUT": "300ms",
		}[key]
	})
	if err != nil || config.StartupTimeout != 2*time.Second || config.ShutdownTimeout != 300*time.Millisecond {
		t.Fatalf("explicit durations ignored: %+v %v", config, err)
	}
	for _, address := range []string{"localhost:80", ":80", "0.0.0.0:80", "[::]:80", "192.0.2.1:80", "[::1%eth0]:80", "127.0.0.1", "127.0.0.1:word", "127.0.0.1:-1", "127.0.0.1:65536", "127.0.0.1:080"} {
		t.Run(address, func(t *testing.T) {
			config := Config{DatabaseURL: "postgres://secret", ListenAddress: address, StartupTimeout: time.Second, ShutdownTimeout: time.Second}
			if err := config.Validate(); err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("expected safe validation error: %v", err)
			}
		})
	}
	for _, config := range []Config{
		{ListenAddress: "127.0.0.1:0", StartupTimeout: time.Second, ShutdownTimeout: time.Second},
		{DatabaseURL: " ", ListenAddress: "127.0.0.1:0", StartupTimeout: time.Second, ShutdownTimeout: time.Second},
		{DatabaseURL: "postgres://db", ListenAddress: "127.0.0.1:0", ShutdownTimeout: time.Second},
		{DatabaseURL: "postgres://db", ListenAddress: "127.0.0.1:0", StartupTimeout: time.Second, ShutdownTimeout: -time.Second},
	} {
		if err := config.Validate(); err == nil {
			t.Fatalf("invalid config accepted: %+v", config)
		}
	}
}
