# Control Tower — API Contract

This is the shared source of truth between backend and frontend. Both sides build
to match this exactly — field names, casing, and types. If either side needs to
change something here, say so before changing it, don't just change it on your end.

**Base URL (dev):** `http://localhost:8000`
**Frontend origin (for CORS):** `http://localhost:5173`
**Content type:** `application/json` for all requests/responses.
**Dates:** calendar dates as `"YYYY-MM-DD"` (e.g. `"2026-06-05"`). Timestamps as
ISO 8601 UTC with a `Z` suffix (e.g. `"2026-06-05T09:00:00Z"`).
**Errors:** any 4xx/5xx returns `{"detail": "human-readable message"}` (FastAPI's default — don't override it).

---

## Shared enums (use these exact lowercase strings everywhere — backend and frontend)

```
facility_type      : "clinic" | "hospital" | "distributor" | "warehouse"
stock_status       : "surplus" | "warning" | "critical" | "stockout"
transfer_status    : "pending" | "matched" | "escalated" | "in_transit" | "completed" | "cancelled" | "rejected"
escalation_level   : "peer_facility" | "zonal_distributor" | "regional_authority"
match_status       : "proposed" | "accepted" | "rejected" | "delivered"
```

These match `models.py` verbatim — no re-casing, no display-friendly versions in the API layer. If you want "Critical" with a capital C on screen, do that formatting in the frontend, not the backend.

**Note on `transfer_status: "pending"`** — its meaning changed from the original design. It now specifically means *"awaiting the target facility's accept/reject decision"*, not "not yet processed." A request only leaves `pending` when someone calls `PATCH /transfers/{id}/respond` (see below).

---

## GET /facilities

Powers `MapView.jsx`. Returns GeoJSON so it can be dropped straight into a Leaflet layer.

Each facility gets one `worst_status` — the most severe status among all its medicines — since a map pin can only be one color. `MapView.jsx` colors the pin using `worst_status` via `statusColors.js`.

**Response `200`**
```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [77.5946, 12.9716] },
      "properties": {
        "id": 3,
        "name": "Clinic-3",
        "type": "clinic",
        "zone_id": 1,
        "parent_facility_id": 9,
        "worst_status": "critical",
        "medicines": [
          { "medicine_id": 5, "medicine_name": "Antiviral (Oseltamivir)", "status": "critical", "current_stock": 4.2 },
          { "medicine_id": 2, "medicine_name": "Amoxicillin 500mg", "status": "surplus", "current_stock": 88.0 }
        ]
      }
    }
  ]
}
```

Note: `coordinates` is `[longitude, latitude]` — GeoJSON order, not `[lat, lon]`. This trips people up constantly; double-check it in `MapView.jsx`.

---

## GET /inventory

Powers `TriageSummary.jsx`. Query params are all optional filters.

**Query params:** `facility_id`, `medicine_id`, `status`

**Response `200`**
```json
{
  "summary": { "critical": 4, "warning": 9, "surplus": 24 },
  "items": [
    {
      "facility_id": 3,
      "facility_name": "Clinic-3",
      "medicine_id": 5,
      "medicine_name": "Antiviral (Oseltamivir)",
      "current_stock": 4.2,
      "avg_daily_consumption": 3.1,
      "status": "critical",
      "updated_at": "2026-06-05T08:00:00Z"
    }
  ]
}
```

`summary` counts are always the totals across ALL facilities/medicines, regardless of filters applied to `items` — `TriageSummary.jsx` cards should never go blank just because someone filtered the list below them.

---

## GET /forecast

Powers `ForecastChart.jsx`. This shape matches `forecast_model.py`'s existing `--json` output exactly — the backend endpoint is a thin wrapper around `run_forecast()`, no reshaping needed.

**Query params:** `facility_id` (required), `medicine_id` (required), `horizon` (default `7`), `lead_time_days` (default `5`)

**Response `200`**
```json
{
  "facility_id": 3,
  "medicine_id": 5,
  "forecast": [
    {
      "date": "2026-06-06",
      "predicted_consumption": 3.61,
      "predicted_stock": 40.46,
      "confidence_lower": 37.76,
      "confidence_upper": 43.15,
      "status": "surplus"
    }
  ]
}
```

**Response `400`** (not enough history — mirrors the `ValueError` already in `forecast_model.py`)
```json
{ "detail": "Only 12 usable rows after feature lags — need 30+ days of history to train reliably." }
```

---

## GET /forecast/suggested-quantity

**New.** Powers the quantity field in `TransferPanel.jsx`'s "request transfer" form. Computes how much a facility should ask for to survive until its parent facility's next shipment — sums `forecast_model.py`'s predicted consumption over the medicine's lead time, minus current stock. This is a *suggestion* the frontend pre-fills; the person submitting the request can still edit the number before sending it.

**Query params:** `facility_id` (required), `medicine_id` (required)

**Response `200`**
```json
{
  "facility_id": 3,
  "medicine_id": 5,
  "suggested_quantity": 42.5,
  "based_on": {
    "current_stock": 4.2,
    "predicted_daily_consumption": 3.1,
    "lead_time_days": 5
  }
}
```

`based_on` is included so the frontend can show a one-line "why this number" tooltip if useful — not required to display it.

**Response `400`** — same shape and same underlying reason as `GET /forecast`'s 400 (not enough history to forecast from).

---

## POST /transfers

Powers `TransferPanel.jsx`'s "request transfer" action. Called when a facility is critical or warning and wants to request supply.

**Changed from the original design:** this no longer auto-resolves to a match. The backend selects exactly **one** target facility (nearest peer with surplus, else walks up `parent_facility_id` to the parent tier) and creates the request with `status: "pending"` — it stays pending until the target facility explicitly responds via `PATCH /transfers/{id}/respond` below. `matches` will contain exactly one entry, with `match_status: "proposed"`.

**Exception — dire situations:** if the shortage is severe enough that `escalation.py`'s `is_dire_situation()` check passes (e.g. predicted stockout is imminent), the backend instead creates **multiple separate `transfer_requests`** — one per candidate target — each independently `pending`, each with its own `id`, all sharing the same `parent_request_id` (pointing at the first one created) so the frontend can visually group them as "part of the same shortage." In that case this endpoint's response is the *first* of those sibling requests; call `GET /transfers?parent_request_id=...` to see the rest.

**Request body**
```json
{
  "requesting_facility_id": 3,
  "medicine_id": 5,
  "quantity_requested": 50,
  "priority": "critical"
}
```

**Response `201`**
```json
{
  "id": 12,
  "requesting_facility_id": 3,
  "medicine_id": 5,
  "quantity_requested": 50,
  "quantity_fulfilled": 0,
  "priority": "critical",
  "status": "pending",
  "current_escalation_level": "peer_facility",
  "parent_request_id": null,
  "is_dire": false,
  "created_at": "2026-06-05T09:00:00Z",
  "resolved_at": null,
  "matches": [
    {
      "id": 7,
      "supplying_facility_id": 9,
      "supplying_facility_name": "Clinic-9",
      "quantity_offered": 50,
      "distance_km": 4.3,
      "estimated_transit_minutes": 12,
      "match_status": "proposed"
    }
  ]
}
```

If no peer surplus exists anywhere at any tier, `status` is `"escalated"` and `matches` is `[]` — this is the one case left where the request can't move forward without a human noticing it on the dashboard.

---

## PATCH /transfers/{id}/respond

**New.** Powers a new incoming-requests view in `TransferPanel.jsx` — the supplying facility explicitly accepts or rejects a proposed match. This is the only way a match's `match_status` changes away from `"proposed"`.

**Request body**
```json
{
  "match_id": 7,
  "action": "accept",
  "quantity_offered": 50
}
```

`action` is `"accept"` or `"reject"`. `quantity_offered` is required on accept (can be less than `quantity_requested` — a partial offer), omitted on reject.

**Behavior:**
- **Reject** → that match's `match_status` becomes `"rejected"`. `escalation.py` immediately looks for the next candidate and adds a *new* `transfer_matches` row (`match_status: "proposed"`) under the same `transfer_requests.id`. The request's `status` stays `"pending"`. The old rejected match stays in the list for history — it isn't deleted.
- **Accept, fully covers the request** (`quantity_fulfilled` reaches `quantity_requested`) → that match becomes `"accepted"`, and `transfer_requests.status` becomes `"in_transit"`.
- **Accept, partially covers the request** → that match becomes `"accepted"`, `quantity_fulfilled` increases by `quantity_offered`, this request's `status` becomes `"in_transit"` for the portion that's confirmed, **and** a new `transfer_requests` row is created automatically for the remaining shortfall (`quantity_requested` = the difference, `parent_request_id` = this request's `id`, `status: "pending"`), targeting the next candidate.

**Response `200`** — the updated `transfer_requests` row, same shape as the `POST /transfers` response above.

Marking an `in_transit` request as fully `"completed"` (actual delivery confirmation) is intentionally out of scope for this prototype — there's no endpoint for it yet. Flag before adding one; it wasn't an oversight.

---

## GET /transfers

Powers `TransferPanel.jsx`'s list view — same per-item shape as the `POST` response above, just wrapped in a list.

**Query params:** `status` (optional filter), `parent_request_id` (optional — use this to fetch all siblings of a dire fan-out or a partial-fulfillment follow-up chain)

**Response `200`**
```json
{
  "items": [
    { "id": 12, "requesting_facility_id": 3, "medicine_id": 5, "quantity_requested": 50,
      "quantity_fulfilled": 0, "priority": "critical", "status": "pending",
      "current_escalation_level": "peer_facility", "parent_request_id": null, "is_dire": false,
      "created_at": "2026-06-05T09:00:00Z", "resolved_at": null,
      "matches": [ { "id": 7, "supplying_facility_id": 9, "supplying_facility_name": "Clinic-9",
                     "quantity_offered": 50, "distance_km": 4.3, "estimated_transit_minutes": 12,
                     "match_status": "proposed" } ] }
  ]
}
```

---

## Frontend build note

Everything above is what `api.js` should wrap — one function per endpoint, returning the parsed JSON as-is. Don't reshape the response inside `api.js`; if a component needs a different shape, reshape it in the component or a small selector, so `api.js` stays a 1:1 mirror of this contract and is easy to diff against it later.
