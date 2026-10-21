package server

import (
	"fmt"
	"net"
	"net/netip"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DatabaseURL     string
	StorageRoot     string
	ListenAddress   string
	StartupTimeout  time.Duration
	ShutdownTimeout time.Duration
}

type ConfigurationError struct {
	Field string
	Rule  string
	cause error
}

func (e *ConfigurationError) Error() string { return fmt.Sprintf("%s %s", e.Field, e.Rule) }
func (e *ConfigurationError) Unwrap() error { return e.cause }

func LoadConfig(getenv func(string) string) (Config, error) {
	startupTimeout, err := loadTimeout(getenv, "DAYNIGHT_STARTUP_TIMEOUT")
	if err != nil {
		return Config{}, err
	}
	shutdownTimeout, err := loadTimeout(getenv, "DAYNIGHT_SHUTDOWN_TIMEOUT")
	if err != nil {
		return Config{}, err
	}
	address := getenv("DAYNIGHT_LISTEN_ADDR")
	if address == "" {
		address = "127.0.0.1:8787"
	}
	config := Config{
		DatabaseURL:     getenv("DAYNIGHT_DATABASE_URL"),
		StorageRoot:     getenv("DAYNIGHT_STORAGE_ROOT"),
		ListenAddress:   address,
		StartupTimeout:  startupTimeout,
		ShutdownTimeout: shutdownTimeout,
	}
	return config, config.Validate()
}

func loadTimeout(getenv func(string) string, field string) (time.Duration, error) {
	value := getenv(field)
	if value == "" {
		return 10 * time.Second, nil
	}
	duration, err := time.ParseDuration(value)
	if err != nil || duration <= 0 {
		return 0, &ConfigurationError{Field: field, Rule: "must be a positive Go duration"}
	}
	return duration, nil
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.DatabaseURL) == "" {
		return &ConfigurationError{Field: "DAYNIGHT_DATABASE_URL", Rule: "is required"}
	}
	if strings.TrimSpace(c.StorageRoot) == "" {
		return &ConfigurationError{Field: "DAYNIGHT_STORAGE_ROOT", Rule: "is required"}
	}
	host, port, err := net.SplitHostPort(c.ListenAddress)
	if err != nil {
		return &ConfigurationError{Field: "DAYNIGHT_LISTEN_ADDR", Rule: "must contain a numeric loopback IP and port"}
	}
	address, err := netip.ParseAddr(host)
	if err != nil || !address.IsLoopback() || address.Zone() != "" {
		return &ConfigurationError{Field: "DAYNIGHT_LISTEN_ADDR", Rule: "must use a numeric loopback IP"}
	}
	number, err := strconv.Atoi(port)
	if err != nil || number < 0 || number > 65535 || strconv.Itoa(number) != port {
		return &ConfigurationError{Field: "DAYNIGHT_LISTEN_ADDR", Rule: "must use a port from 0 to 65535"}
	}
	if c.StartupTimeout <= 0 || c.ShutdownTimeout <= 0 {
		return &ConfigurationError{Field: "timeouts", Rule: "startup and shutdown must be positive"}
	}
	return nil
}
