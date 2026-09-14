"""
Control Tower — ML Forecasting Boilerplate
============================================
Forecasts the next N days of stock/consumption for a single (facility, medicine)
pair using XGBoost with lag + rolling-window features, then classifies each
forecasted day into Surplus / Warning / Critical for the triage dashboard.

Why XGBoost over Prophet here: with dozens of facilities x medicines, fitting
a separate Prophet model per series gets slow and Prophet's install can be
flaky in constrained environments. XGBoost trains fast, handles exogenous
features (day-of-week, rolling stats) naturally, and this same feature set
can later be reused to train ONE global model across all facilities instead
of one-per-series, which usually generalizes better with limited history.
If you specifically want Prophet for its built-in seasonality + uncertainty
intervals, swap train_model()/recursive_forecast() for `Prophet().fit(df)`
and `model.predict(future)` — the classify_status() logic below still works
unchanged since it only needs predicted_stock + predicted_consumption.

Expects a CSV with columns (as produced by generate_mock_data.py):
    date, facility_id, medicine_id, stock_level, consumption, replenishment_received

Usage:
    python forecast_model.py --facility_id 3 --medicine_id 5 --horizon 7
    python forecast_model.py --facility_id 3 --medicine_id 5 --lead_time_days 7 --json
"""

import argparse
import json
import sys
from datetime import timedelta

import numpy as np
import pandas as pd
import xgboost as xgb

LAGS = [1, 2, 3, 7, 14]
ROLL_WINDOWS = [3, 7, 14]

FEATURE_COLS = (
    [f"consumption_lag_{l}" for l in LAGS]
    + [f"stock_lag_{l}" for l in LAGS]
    + [f"consumption_roll_mean_{w}" for w in ROLL_WINDOWS]
    + [f"consumption_roll_std_{w}" for w in ROLL_WINDOWS]
    + ["dayofweek", "day_index"]
)


def load_series(csv_path: str, facility_id: int, medicine_id: int) -> pd.DataFrame:
    df = pd.read_csv(csv_path, parse_dates=["date"])
    df = df[(df.facility_id == facility_id) & (df.medicine_id == medicine_id)]
    df = df.sort_values("date").reset_index(drop=True)
    if df.empty:
        raise ValueError(f"No rows found for facility_id={facility_id}, medicine_id={medicine_id}")
    return df


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Adds lag/rolling/calendar features. Uses .shift(1) before rolling so no
    row ever leaks its own day's value into its own features (no lookahead)."""
    df = df.copy()
    df["dayofweek"] = df["date"].dt.dayofweek
    df["day_index"] = np.arange(len(df))

    for lag in LAGS:
        df[f"consumption_lag_{lag}"] = df["consumption"].shift(lag)
        df[f"stock_lag_{lag}"] = df["stock_level"].shift(lag)

    for w in ROLL_WINDOWS:
        df[f"consumption_roll_mean_{w}"] = df["consumption"].shift(1).rolling(w).mean()
        df[f"consumption_roll_std_{w}"] = df["consumption"].shift(1).rolling(w).std()

    df["target_consumption"] = df["consumption"]
    return df


def train_model(feat_df: pd.DataFrame):
    """Chronological train/validation split (no shuffling — this is time series).
    Returns the fitted model plus the validation residual std, used to widen
    the confidence band as the forecast horizon grows."""
    data = feat_df.dropna(subset=FEATURE_COLS + ["target_consumption"])
    if len(data) < 30:
        raise ValueError(
            f"Only {len(data)} usable rows after feature lags — need 30+ days of "
            "history to train reliably. Let the simulation run longer or lower the lags."
        )

    split = int(len(data) * 0.85)
    train, valid = data.iloc[:split], data.iloc[split:]

    model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="reg:squarederror",
        random_state=42,
    )
    model.fit(
        train[FEATURE_COLS], train["target_consumption"],
        eval_set=[(valid[FEATURE_COLS], valid["target_consumption"])],
        verbose=False,
    )

    if len(valid) > 0:
        preds = model.predict(valid[FEATURE_COLS])
        residual_std = float(np.std(valid["target_consumption"].values - preds))
    else:
        residual_std = float(train["target_consumption"].std())

    return model, residual_std


def recursive_forecast(model, raw_df: pd.DataFrame, horizon: int, residual_std: float):
    """Multi-step forecast: predict day+1's consumption, roll it into history
    as a synthetic row so day+2's lag features can be built from it, repeat.
    Errors compound over the horizon — that's exactly why the confidence band
    widens with each step below (residual_std * step)."""
    history = raw_df.copy()
    last_stock = float(history["stock_level"].iloc[-1])
    last_date = history["date"].iloc[-1]

    forecasts = []
    for step in range(1, horizon + 1):
        feat_row = build_features(history).iloc[[-1]]
        x = feat_row[FEATURE_COLS]

        if x.isnull().any(axis=1).iloc[0]:
            # not enough history yet to build full lag features — fall back
            # to a short trailing average rather than crashing
            pred_consumption = float(history["consumption"].tail(7).mean())
        else:
            pred_consumption = float(model.predict(x)[0])
        pred_consumption = max(0.0, pred_consumption)

        forecast_date = last_date + timedelta(days=step)
        predicted_stock = max(0.0, last_stock - pred_consumption)

        lower = max(0.0, predicted_stock - residual_std * step)
        upper = predicted_stock + residual_std * step

        forecasts.append({
            "date": forecast_date.date().isoformat(),
            "predicted_consumption": round(pred_consumption, 2),
            "predicted_stock": int(round(predicted_stock)),
            "confidence_lower": int(round(lower)),
            "confidence_upper": int(round(upper)),
        })

        # append the prediction as a synthetic row so the NEXT iteration's
        # lag/rolling features are computed including today's forecast
        new_row = {
            "date": forecast_date,
            "facility_id": history["facility_id"].iloc[-1],
            "medicine_id": history["medicine_id"].iloc[-1],
            "stock_level": int(round(predicted_stock)),
            "consumption": round(pred_consumption, 2),
            "replenishment_received": 0,
        }
        history = pd.concat([history, pd.DataFrame([new_row])], ignore_index=True)
        last_stock = predicted_stock

    return forecasts


def classify_status(current_stock: float, predicted_daily_consumption: float,
                     lead_time_days: int, warning_multiplier: float = 1.5,
                     critical_multiplier: float = 1.0) -> str:
    """
    days_remaining = current_stock / predicted_daily_consumption

    CRITICAL — days_remaining <= lead_time_days
               (won't survive even one resupply cycle: escalate now)
    WARNING  — days_remaining <= lead_time_days * warning_multiplier
               (will run out before a resupply placed "soon" would land)
    SURPLUS  — otherwise
    """
    if predicted_daily_consumption <= 0:
        return "surplus"
    days_remaining = current_stock / predicted_daily_consumption
    if days_remaining <= lead_time_days * critical_multiplier:
        return "critical"
    elif days_remaining <= lead_time_days * warning_multiplier:
        return "warning"
    return "surplus"


def run_forecast(csv_path: str, facility_id: int, medicine_id: int,
                  horizon: int = 7, lead_time_days: int = 5) -> list:
    raw = load_series(csv_path, facility_id, medicine_id)
    feat_df = build_features(raw)
    model, residual_std = train_model(feat_df)
    forecasts = recursive_forecast(model, raw, horizon, residual_std)

    for f in forecasts:
        f["status"] = classify_status(f["predicted_stock"], f["predicted_consumption"], lead_time_days)

    return forecasts


def main():
    parser = argparse.ArgumentParser(description="Forecast next-N-days medicine stock for one facility.")
    parser.add_argument("--csv", default="inventory_logs.csv", help="Path to inventory_logs.csv")
    parser.add_argument("--facility_id", type=int, required=True)
    parser.add_argument("--medicine_id", type=int, required=True)
    parser.add_argument("--horizon", type=int, default=7, help="Days ahead to forecast")
    parser.add_argument("--lead_time_days", type=int, default=5, help="Resupply lead time for this medicine")
    parser.add_argument("--json", action="store_true", help="Print raw JSON instead of a table")
    args = parser.parse_args()

    try:
        forecasts = run_forecast(args.csv, args.facility_id, args.medicine_id,
                                  args.horizon, args.lead_time_days)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.json:
        print(json.dumps({
            "facility_id": args.facility_id,
            "medicine_id": args.medicine_id,
            "forecast": forecasts,
        }, indent=2))
    else:
        print(f"\n{args.horizon}-day forecast — Facility {args.facility_id}, Medicine {args.medicine_id}\n")
        print(pd.DataFrame(forecasts).to_string(index=False))


if __name__ == "__main__":
    main()
