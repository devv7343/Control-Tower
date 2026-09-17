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
intervals, swap train_model()/recursive_forecast() for `Prophet().fit(dataframe)`
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
    [f"consumption_lag_{lag}" for lag in LAGS]
    + [f"stock_lag_{lag}" for lag in LAGS]
    + [f"consumption_roll_mean_{window}" for window in ROLL_WINDOWS]
    + [f"consumption_roll_std_{window}" for window in ROLL_WINDOWS]
    + ["dayofweek", "day_index"]
)


def load_series(csv_path: str, facility_id: int, medicine_id: int) -> pd.DataFrame:
    """Loads historical consumption data for a specific facility and medicine."""
    dataframe = pd.read_csv(csv_path, parse_dates=["date"])
    dataframe = dataframe[(dataframe.facility_id == facility_id) & (dataframe.medicine_id == medicine_id)]
    dataframe = dataframe.sort_values("date").reset_index(drop=True)
    if dataframe.empty:
        raise ValueError(f"No rows found for facility_id={facility_id}, medicine_id={medicine_id}")
    return dataframe


def build_features(dataframe: pd.DataFrame) -> pd.DataFrame:
    """Adds lag/rolling/calendar features. Uses .shift(1) before rolling so no
    row ever leaks its own day's value into its own features (no lookahead)."""
    dataframe = dataframe.copy()
    dataframe["dayofweek"] = dataframe["date"].dt.dayofweek
    dataframe["day_index"] = np.arange(len(dataframe))

    for lag in LAGS:
        dataframe[f"consumption_lag_{lag}"] = dataframe["consumption"].shift(lag)
        dataframe[f"stock_lag_{lag}"] = dataframe["stock_level"].shift(lag)

    for window in ROLL_WINDOWS:
        dataframe[f"consumption_roll_mean_{window}"] = dataframe["consumption"].shift(1).rolling(window).mean()
        dataframe[f"consumption_roll_std_{window}"] = dataframe["consumption"].shift(1).rolling(window).std()

    dataframe["target_consumption"] = dataframe["consumption"]
    return dataframe


def train_model(features_dataframe: pd.DataFrame):
    """Chronological train/validation split (no shuffling — this is time series).
    Returns the fitted model plus the validation residual std, used to widen
    the confidence band as the forecast horizon grows."""
    data = features_dataframe.dropna(subset=FEATURE_COLS + ["target_consumption"])
    if len(data) < 30:
        raise ValueError(
            f"Only {len(data)} usable rows after feature lags — need 30+ days of "
            "history to train reliably. Let the simulation run longer or lower the lags."
        )

    split_index = int(len(data) * 0.85)
    train, valid = data.iloc[:split_index], data.iloc[split_index:]

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
        predictions = model.predict(valid[FEATURE_COLS])
        residual_std = float(np.std(valid["target_consumption"].values - predictions))
    else:
        residual_std = float(train["target_consumption"].std())

    return model, residual_std


def recursive_forecast(model, raw_dataframe: pd.DataFrame, horizon: int, residual_std: float):
    """Multi-step forecast: predict day+1's consumption, roll it into history
    as a synthetic row so day+2's lag features can be built from it, repeat.
    Errors compound over the horizon — that's exactly why the confidence band
    widens with each step below (residual_std * step)."""
    history = raw_dataframe.copy()
    last_stock = float(history["stock_level"].iloc[-1])
    last_date = history["date"].iloc[-1]

    forecasts = []
    for step in range(1, horizon + 1):
        feature_row = build_features(history).iloc[[-1]]
        features_x = feature_row[FEATURE_COLS]

        if features_x.isnull().any(axis=1).iloc[0]:
            # not enough history yet to build full lag features — fall back
            # to a short trailing average rather than crashing
            predicted_consumption = float(history["consumption"].tail(7).mean())
        else:
            predicted_consumption = float(model.predict(features_x)[0])
            
        predicted_consumption = max(0.0, predicted_consumption)

        forecast_date = last_date + timedelta(days=step)
        predicted_stock = max(0.0, last_stock - predicted_consumption)

        lower_bound = max(0.0, predicted_stock - residual_std * step)
        upper_bound = predicted_stock + residual_std * step

        forecasts.append({
            "date": forecast_date.date().isoformat(),
            "predicted_consumption": round(predicted_consumption, 2),
            "predicted_stock": int(round(predicted_stock)),
            "confidence_lower": int(round(lower_bound)),
            "confidence_upper": int(round(upper_bound)),
        })

        # append the prediction as a synthetic row so the NEXT iteration's
        # lag/rolling features are computed including today's forecast
        new_row = {
            "date": forecast_date,
            "facility_id": history["facility_id"].iloc[-1],
            "medicine_id": history["medicine_id"].iloc[-1],
            "stock_level": int(round(predicted_stock)),
            "consumption": round(predicted_consumption, 2),
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
    elif days_remaining <= 10 or days_remaining <= lead_time_days * warning_multiplier:
        return "warning"
    return "surplus"


def run_forecast(csv_path: str, facility_id: int, medicine_id: int,
                  horizon: int = 7, lead_time_days: int = 5) -> list:
    raw_dataframe = load_series(csv_path, facility_id, medicine_id)
    features_dataframe = build_features(raw_dataframe)
    model, residual_std = train_model(features_dataframe)
    forecasts = recursive_forecast(model, raw_dataframe, horizon, residual_std)

    for forecast_day in forecasts:
        forecast_day["status"] = classify_status(
            forecast_day["predicted_stock"], 
            forecast_day["predicted_consumption"], 
            lead_time_days
        )

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
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
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
