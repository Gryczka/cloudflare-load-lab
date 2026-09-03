package agent

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/Gryczka/cloudflare-load-lab/generator/internal/metrics"
	"github.com/Gryczka/cloudflare-load-lab/generator/internal/script"
)

const version = "0.1.0"

type PrepareRequest struct {
	RunID           string         `json:"runId"`
	AssignmentID    string         `json:"assignmentId"`
	CallbackURL     string         `json:"callbackUrl"`
	CallbackToken   string         `json:"callbackToken"`
	TargetOrigin    string         `json:"targetOrigin"`
	Tasks           []script.Task  `json:"tasks"`
	Profile         script.Profile `json:"profile"`
	RequestedRegion string         `json:"requestedRegion"`
}

type StartRequest struct {
	StartAt string `json:"startAt"`
}

type Agent struct {
	mu sync.Mutex

	state         string
	prepared      *PrepareRequest
	placement     metrics.Placement
	process       *exec.Cmd
	stopCh        chan struct{}
	stopRequested bool
	startedAt     string
	completedAt   string
	lastError     string

	client *http.Client
}

func New() *Agent {
	return &Agent{
		state:  "idle",
		stopCh: make(chan struct{}),
		placement: metrics.Placement{
			ActualRegion: os.Getenv("CLOUDFLARE_REGION"),
			Location:     os.Getenv("CLOUDFLARE_LOCATION"),
			Country:      os.Getenv("CLOUDFLARE_COUNTRY_A2"),
		},
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

func (a *Agent) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", a.health)
	mux.HandleFunc("GET /health", a.health)
	mux.HandleFunc("GET /status", a.status)
	mux.HandleFunc("POST /prepare", a.prepare)
	mux.HandleFunc("POST /start", a.start)
	mux.HandleFunc("POST /stop", a.stop)
	return withJSON(mux)
}

func withJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Content-Type", "application/json")
		response.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(response, request)
	})
}

func (a *Agent) health(response http.ResponseWriter, _ *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	writeJSON(response, http.StatusOK, map[string]any{
		"ok": true, "version": version, "engineVersion": "k6 2.2.0",
		"state": a.state, "placement": a.placement,
	})
}

func (a *Agent) status(response http.ResponseWriter, _ *http.Request) {
	a.mu.Lock()
	defer a.mu.Unlock()
	writeJSON(response, http.StatusOK, map[string]any{
		"state": a.state, "placement": a.placement, "startedAt": a.startedAt,
		"completedAt": a.completedAt, "error": a.lastError,
	})
}

func (a *Agent) prepare(response http.ResponseWriter, request *http.Request) {
	var input PrepareRequest
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if err := validatePrepare(input); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	if _, err := script.Generate(script.Input{
		TargetOrigin: input.TargetOrigin, Tasks: input.Tasks, Profile: input.Profile,
	}); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.state == "running" || a.state == "scheduled" || a.state == "stopping" {
		writeError(response, http.StatusConflict, errors.New("generator is already busy"))
		return
	}
	if a.prepared != nil && a.prepared.AssignmentID != input.AssignmentID {
		writeError(response, http.StatusConflict, errors.New("generator is reserved for another assignment"))
		return
	}

	a.placement.RequestedRegion = input.RequestedRegion
	a.prepared = &input
	a.state = "prepared"
	a.stopCh = make(chan struct{})
	a.stopRequested = false
	a.startedAt, a.completedAt, a.lastError = "", "", ""
	writeJSON(response, http.StatusOK, map[string]any{
		"ready": true, "placement": a.placement, "engineVersion": "k6 2.2.0",
	})
}

func (a *Agent) start(response http.ResponseWriter, request *http.Request) {
	var input StartRequest
	if err := decodeJSON(request, &input); err != nil {
		writeError(response, http.StatusBadRequest, err)
		return
	}
	startAt, err := time.Parse(time.RFC3339Nano, input.StartAt)
	if err != nil {
		writeError(response, http.StatusBadRequest, fmt.Errorf("invalid startAt: %w", err))
		return
	}

	a.mu.Lock()
	if a.prepared == nil || a.state != "prepared" {
		a.mu.Unlock()
		writeError(response, http.StatusConflict, errors.New("generator is not prepared"))
		return
	}
	config := *a.prepared
	a.state = "scheduled"
	a.mu.Unlock()

	go a.execute(config, startAt)
	writeJSON(response, http.StatusAccepted, map[string]any{"accepted": true, "startAt": startAt})
}

func (a *Agent) stop(response http.ResponseWriter, _ *http.Request) {
	a.requestStop()
	writeJSON(response, http.StatusAccepted, map[string]any{"accepted": true})
}

func (a *Agent) requestStop() {
	a.mu.Lock()
	if !a.stopRequested {
		close(a.stopCh)
		a.stopRequested = true
	}
	if a.state == "prepared" || a.state == "scheduled" || a.state == "running" {
		a.state = "stopping"
	}
	process := a.process
	a.mu.Unlock()

	if process != nil && process.Process != nil {
		_ = syscall.Kill(-process.Process.Pid, syscall.SIGINT)
		go func() {
			time.Sleep(4 * time.Second)
			a.mu.Lock()
			stillRunning := a.process == process
			a.mu.Unlock()
			if stillRunning {
				_ = syscall.Kill(-process.Process.Pid, syscall.SIGKILL)
			}
		}()
	}
}

func (a *Agent) execute(config PrepareRequest, startAt time.Time) {
	wait := time.Until(startAt)
	if wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-timer.C:
		case <-a.stopCh:
			if !timer.Stop() {
				<-timer.C
			}
			a.finish(config, "cancelled", "")
			return
		}
	}

	scriptBytes, err := script.Generate(script.Input{
		TargetOrigin: config.TargetOrigin, Tasks: config.Tasks, Profile: config.Profile,
	})
	if err != nil {
		a.finish(config, "error", err.Error())
		return
	}

	directory, err := os.MkdirTemp("/tmp/loadlab", "run-")
	if err != nil {
		a.finish(config, "error", "unable to allocate run workspace")
		return
	}
	defer os.RemoveAll(directory)
	scriptPath := filepath.Join(directory, "scenario.js")
	metricsPath := filepath.Join(directory, "metrics.ndjson")
	if err := os.WriteFile(scriptPath, scriptBytes, 0o600); err != nil {
		a.finish(config, "error", "unable to stage scenario")
		return
	}
	file, err := os.OpenFile(metricsPath, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		a.finish(config, "error", "unable to initialize metrics output")
		return
	}
	_ = file.Close()

	command := exec.Command("k6", "run", "--quiet", "--no-color", "--out", "json="+metricsPath, scriptPath)
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	var stderr bytes.Buffer
	command.Stdout = io.Discard
	command.Stderr = &stderr

	a.mu.Lock()
	if a.stopRequested {
		a.mu.Unlock()
		a.finish(config, "cancelled", "")
		return
	}
	a.process = command
	a.state = "running"
	a.startedAt = time.Now().UTC().Format(time.RFC3339Nano)
	a.mu.Unlock()

	if err := command.Start(); err != nil {
		a.clearProcess(command)
		a.finish(config, "error", "unable to start k6")
		return
	}

	aggregator := metrics.New(config.RunID, config.AssignmentID, a.placement)
	tailStop := make(chan struct{})
	tailDone := make(chan struct{})
	go func() {
		defer close(tailDone)
		tailMetrics(metricsPath, tailStop, aggregator)
	}()

	flushStop := make(chan struct{})
	flushDone := make(chan struct{})
	go func() {
		defer close(flushDone)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				a.sendMetrics(config, aggregator.Flush())
			case <-flushStop:
				a.sendMetrics(config, aggregator.Flush())
				return
			}
		}
	}()

	runErr := command.Wait()
	a.clearProcess(command)
	close(tailStop)
	<-tailDone
	close(flushStop)
	<-flushDone

	a.mu.Lock()
	stopped := a.stopRequested
	a.mu.Unlock()
	if stopped {
		a.finish(config, "cancelled", "")
		return
	}
	if runErr != nil {
		log.Printf("k6 assignment %s failed: %v: %s", config.AssignmentID, runErr, truncate(stderr.String(), 2_000))
		a.finish(config, "error", "k6 execution failed")
		return
	}
	a.finish(config, "complete", "")
}

func (a *Agent) clearProcess(command *exec.Cmd) {
	a.mu.Lock()
	if a.process == command {
		a.process = nil
	}
	a.mu.Unlock()
}

func tailMetrics(path string, stop <-chan struct{}, aggregator *metrics.Aggregator) {
	file, err := os.Open(path)
	if err != nil {
		log.Printf("open metrics output: %v", err)
		return
	}
	defer file.Close()
	reader := bufio.NewReaderSize(file, 128*1024)
	for {
		line, err := reader.ReadBytes('\n')
		if len(bytes.TrimSpace(line)) > 0 {
			if parseErr := aggregator.AddJSON(bytes.TrimSpace(line)); parseErr != nil {
				log.Printf("parse k6 metric: %v", parseErr)
			}
		}
		if err == nil {
			continue
		}
		if !errors.Is(err, io.EOF) {
			log.Printf("read metrics output: %v", err)
			return
		}
		select {
		case <-stop:
			return
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func (a *Agent) sendMetrics(config PrepareRequest, batch metrics.Batch) {
	payload := map[string]any{"token": config.CallbackToken, "batch": batch}
	if err := a.post(config.CallbackURL+"/api/internal/metrics", payload); err != nil {
		log.Printf("metric callback for %s failed: %v", config.AssignmentID, err)
	}
}

func (a *Agent) finish(config PrepareRequest, status, message string) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	a.mu.Lock()
	a.state = status
	a.completedAt = now
	a.lastError = message
	a.mu.Unlock()

	payload := map[string]any{
		"token": config.CallbackToken, "runId": config.RunID,
		"assignmentId": config.AssignmentID, "status": status,
		"completedAt": now,
	}
	if message != "" {
		payload["error"] = truncate(message, 500)
	}
	if err := a.post(config.CallbackURL+"/api/internal/complete", payload); err != nil {
		log.Printf("completion callback for %s failed: %v", config.AssignmentID, err)
	}
}

func (a *Agent) post(endpoint string, payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		request, err := http.NewRequestWithContext(context.Background(), http.MethodPost, endpoint, bytes.NewReader(encoded))
		if err != nil {
			return err
		}
		request.Header.Set("Content-Type", "application/json")
		response, err := a.client.Do(request)
		if err == nil {
			_, _ = io.Copy(io.Discard, response.Body)
			_ = response.Body.Close()
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				return nil
			}
			err = fmt.Errorf("callback returned %s", response.Status)
		}
		lastErr = err
		time.Sleep(time.Duration(attempt+1) * 150 * time.Millisecond)
	}
	return lastErr
}

func validatePrepare(input PrepareRequest) error {
	if input.RunID == "" || input.AssignmentID == "" || len(input.CallbackToken) < 32 {
		return errors.New("runId, assignmentId, and callbackToken are required")
	}
	for label, value := range map[string]string{"callbackUrl": input.CallbackURL, "targetOrigin": input.TargetOrigin} {
		parsed, err := url.Parse(value)
		if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
			return fmt.Errorf("%s must be an HTTP(S) URL", label)
		}
	}
	return nil
}

func decodeJSON(request *http.Request, target any) error {
	defer request.Body.Close()
	decoder := json.NewDecoder(io.LimitReader(request.Body, 512*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return nil
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.WriteHeader(status)
	_ = json.NewEncoder(response).Encode(value)
}

func writeError(response http.ResponseWriter, status int, err error) {
	writeJSON(response, status, map[string]string{"error": err.Error()})
}

func truncate(value string, limit int) string {
	value = strings.TrimSpace(value)
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}
