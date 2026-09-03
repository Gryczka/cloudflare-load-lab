package metrics

import (
	"testing"
)

func TestAggregatorCollectsK6Points(t *testing.T) {
	a := New("run", "assignment", Placement{RequestedRegion: "ENAM"})
	lines := []string{
		`{"metric":"http_reqs","type":"Point","data":{"time":"2026-01-01T00:00:00Z","value":1,"tags":{}}}`,
		`{"metric":"http_req_duration","type":"Point","data":{"time":"2026-01-01T00:00:00Z","value":42,"tags":{}}}`,
		`{"metric":"http_req_failed","type":"Point","data":{"time":"2026-01-01T00:00:00Z","value":1,"tags":{"status":"503"}}}`,
	}
	for _, line := range lines {
		if err := a.AddJSON([]byte(line)); err != nil {
			t.Fatal(err)
		}
	}
	batch := a.Flush()
	if batch.Requests != 1 || batch.FailedRequests != 1 || batch.Latency.Count != 1 {
		t.Fatalf("unexpected batch: %+v", batch)
	}
	if batch.Errors["HTTP 503"] != 1 {
		t.Fatalf("expected classified status, got: %+v", batch.Errors)
	}
	if next := a.Flush(); next.Requests != 0 || next.VUs != batch.VUs {
		t.Fatalf("delta counters did not reset: %+v", next)
	}
}
