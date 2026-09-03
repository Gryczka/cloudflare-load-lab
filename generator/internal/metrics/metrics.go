package metrics

import (
	"encoding/json"
	"math"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

var LatencyBounds = []float64{5, 10, 25, 50, 100, 200, 300, 500, 750, 1000, 2000, 5000, 10000, 30000, 60000}

type Point struct {
	Metric string `json:"metric"`
	Type   string `json:"type"`
	Data   struct {
		Time  time.Time         `json:"time"`
		Value float64           `json:"value"`
		Tags  map[string]string `json:"tags"`
	} `json:"data"`
}

type Placement struct {
	RequestedRegion string `json:"requestedRegion"`
	ActualRegion    string `json:"actualRegion,omitempty"`
	Location        string `json:"location,omitempty"`
	Country         string `json:"country,omitempty"`
}

type Histogram struct {
	Bounds []float64 `json:"bounds"`
	Counts []int64   `json:"counts"`
	Count  int64     `json:"count"`
	Sum    float64   `json:"sum"`
	Max    float64   `json:"max"`
}

type Batch struct {
	RunID             string         `json:"runId"`
	AssignmentID      string         `json:"assignmentId"`
	Sequence          int64          `json:"sequence"`
	Timestamp         string         `json:"timestamp"`
	Placement         Placement      `json:"placement"`
	Requests          int64          `json:"requests"`
	FailedRequests    int64          `json:"failedRequests"`
	Checks            int64          `json:"checks"`
	FailedChecks      int64          `json:"failedChecks"`
	Iterations        int64          `json:"iterations"`
	DroppedIterations int64          `json:"droppedIterations"`
	DataSent          int64          `json:"dataSent"`
	DataReceived      int64          `json:"dataReceived"`
	VUs               int64          `json:"vus"`
	VUsMax            int64          `json:"vusMax"`
	Latency           Histogram      `json:"latency"`
	Errors            map[string]int `json:"errors"`
}

type Aggregator struct {
	mu sync.Mutex

	runID        string
	assignmentID string
	placement    Placement
	sequence     int64

	requests          int64
	failedRequests    int64
	checks            int64
	failedChecks      int64
	iterations        int64
	droppedIterations int64
	dataSent          int64
	dataReceived      int64
	vus               int64
	vusMax            int64
	latencyCounts     []int64
	latencyCount      int64
	latencySum        float64
	latencyMax        float64
	errors            map[string]int
}

func New(runID, assignmentID string, placement Placement) *Aggregator {
	return &Aggregator{
		runID: runID, assignmentID: assignmentID, placement: placement,
		latencyCounts: make([]int64, len(LatencyBounds)), errors: map[string]int{},
	}
}

func (a *Aggregator) AddJSON(line []byte) error {
	var point Point
	if err := json.Unmarshal(line, &point); err != nil {
		return err
	}
	if point.Type != "Point" {
		return nil
	}
	a.Add(point)
	return nil
}

func (a *Aggregator) Add(point Point) {
	a.mu.Lock()
	defer a.mu.Unlock()

	value := point.Data.Value
	switch point.Metric {
	case "http_reqs":
		a.requests += int64(math.Round(value))
	case "http_req_failed":
		if value > 0 {
			a.failedRequests += int64(math.Max(1, math.Round(value)))
			label := failureLabel(point.Data.Tags)
			a.errors[label]++
		}
	case "http_req_duration":
		a.latencyCount++
		a.latencySum += value
		if value > a.latencyMax {
			a.latencyMax = value
		}
		bucket := len(LatencyBounds) - 1
		for index, bound := range LatencyBounds {
			if value <= bound {
				bucket = index
				break
			}
		}
		a.latencyCounts[bucket]++
	case "checks":
		a.checks++
		if value < 1 {
			a.failedChecks++
		}
	case "iterations":
		a.iterations += int64(math.Round(value))
	case "dropped_iterations":
		a.droppedIterations += int64(math.Round(value))
	case "data_sent":
		a.dataSent += int64(math.Round(value))
	case "data_received":
		a.dataReceived += int64(math.Round(value))
	case "vus":
		a.vus = int64(math.Round(value))
	case "vus_max":
		a.vusMax = int64(math.Round(value))
	}
}

func failureLabel(tags map[string]string) string {
	if value := tags["error"]; value != "" {
		return truncate(strings.TrimSpace(value), 120)
	}
	if value := tags["status"]; value != "" && value != "0" {
		if _, err := strconv.Atoi(value); err == nil {
			return "HTTP " + value
		}
	}
	if value := tags["error_code"]; value != "" {
		return "error " + truncate(value, 40)
	}
	return "request failed"
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "…"
}

func (a *Aggregator) Flush() Batch {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.sequence++

	errors := map[string]int{}
	keys := make([]string, 0, len(a.errors))
	for key := range a.errors {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		errors[key] = a.errors[key]
	}

	batch := Batch{
		RunID: a.runID, AssignmentID: a.assignmentID, Sequence: a.sequence,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano), Placement: a.placement,
		Requests: a.requests, FailedRequests: a.failedRequests,
		Checks: a.checks, FailedChecks: a.failedChecks, Iterations: a.iterations,
		DroppedIterations: a.droppedIterations, DataSent: a.dataSent,
		DataReceived: a.dataReceived, VUs: a.vus, VUsMax: a.vusMax,
		Latency: Histogram{
			Bounds: append([]float64(nil), LatencyBounds...),
			Counts: append([]int64(nil), a.latencyCounts...),
			Count:  a.latencyCount, Sum: a.latencySum, Max: a.latencyMax,
		},
		Errors: errors,
	}

	a.requests, a.failedRequests, a.checks, a.failedChecks = 0, 0, 0, 0
	a.iterations, a.droppedIterations, a.dataSent, a.dataReceived = 0, 0, 0, 0
	a.latencyCounts = make([]int64, len(LatencyBounds))
	a.latencyCount, a.latencySum, a.latencyMax = 0, 0, 0
	a.errors = map[string]int{}
	return batch
}
