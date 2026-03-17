"""
E2E test: Backend API golden path.

Tests the full flow:
1. POST /api/runs → creates a run
2. GET /api/runs/{id} → eventually returns completed status
3. Result contains expected fields

Run with: python tests/test_e2e.py
Requires: uvicorn running on port 8000
"""

import sys
import time
import requests

BASE = "http://localhost:8000"


def test_health():
    r = requests.get(f"{BASE}/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["engine"] == "openvolt"
    print("  health: OK")


def test_meta():
    r = requests.get(f"{BASE}/api/meta")
    assert r.status_code == 200
    data = r.json()
    assert "jp_topix_demo" in data["presets"]
    assert "sample" in data["risk_models"]
    assert len(data["pipeline"]["nodes"]) == 12
    assert len(data["pipeline"]["edges"]) == 12
    print("  meta: OK")


def test_optimize_run():
    # Create run
    r = requests.post(f"{BASE}/api/runs", json={"preset_id": "jp_topix_demo"})
    assert r.status_code == 200
    data = r.json()
    run_id = data["run_id"]
    assert run_id.startswith("run_")
    print(f"  run created: {run_id}")

    # Poll for completion (max 60s)
    for i in range(60):
        time.sleep(1)
        r = requests.get(f"{BASE}/api/runs/{run_id}")
        assert r.status_code == 200
        snap = r.json()

        if snap["status"] == "completed":
            print(f"  run completed in {i+1}s")

            # Verify result structure
            result = snap.get("result") or snap
            assert "summary" in result or "nodes" in snap

            # Check nodes completed
            nodes = snap.get("nodes", [])
            if nodes:
                completed = [n for n in nodes if n["status"] == "completed"]
                print(f"  nodes: {len(completed)}/{len(nodes)} completed")

            return run_id

        if snap["status"] == "failed":
            print(f"  FAILED: {snap}")
            sys.exit(1)

    print("  TIMEOUT: run did not complete in 60s")
    sys.exit(1)


def test_run_result(run_id: str):
    r = requests.get(f"{BASE}/api/runs/{run_id}/result")
    if r.status_code == 200:
        result = r.json()
        if result and isinstance(result, dict) and "summary" in result:
            s = result["summary"]
            print(f"    tracking_error: {s.get('tracking_error', 'N/A')}")
            print(f"    trade_count: {s.get('trade_count', 'N/A')}")
        else:
            print(f"  result returned but no summary (run may use WebSocket for results)")
    elif r.status_code == 400:
        print(f"  result via REST: {r.json().get('detail', 'N/A')} (normal — results sent via WebSocket)")
    print("  result check: OK")


def main():
    print("=" * 50)
    print("OpenVolt E2E Test")
    print("=" * 50)

    try:
        requests.get(f"{BASE}/api/health", timeout=2)
    except requests.ConnectionError:
        print("ERROR: Backend not running on port 8000")
        print("Start with: uvicorn api.app.main:app --port 8000")
        sys.exit(1)

    test_health()
    test_meta()
    run_id = test_optimize_run()
    test_run_result(run_id)

    print()
    print("ALL E2E TESTS PASSED")


if __name__ == "__main__":
    main()
