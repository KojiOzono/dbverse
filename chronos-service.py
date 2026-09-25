# service.py
import time
import torch
import numpy as np
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from chronos import Chronos2Pipeline

app = FastAPI(title="Chronos-2 Inference Service")

# 他アプリから叩けるようにCORS開放
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

QUANTILE_LEVELS = [0.1, 0.25, 0.5, 0.75, 0.9]


# ============================================================
# モデルロード
# ============================================================
print("Loading Chronos-2 model...")
pipeline = Chronos2Pipeline.from_pretrained(
    "amazon/chronos-2",
    device_map="cpu"
)
print("Model loaded!")


# ============================================================
# 推論
# ============================================================
def run_forecast(context_values: list[float], prediction_length: int,
                 x_values: list | None = None):
    if not context_values:
        raise ValueError("context_values must not be empty")
    if prediction_length <= 0:
        raise ValueError("prediction_length must be a positive integer")

    start_time = time.perf_counter()
    context_tensor = torch.tensor(context_values, dtype=torch.float32)

    # ★ x_values が来ていれば共変量として渡す
    if x_values and len(x_values) == len(context_values):
        try:
            x_tensor = torch.tensor(x_values, dtype=torch.float32)
            inputs = [{
                "target": context_tensor,
                "past_covariates": {"x": x_tensor},
            }]
        except (ValueError, TypeError):
            # 数値化できないXは無視して、いつも通り
            inputs = [{"target": context_tensor}]
    else:
        inputs = [{"target": context_tensor}]

    quantiles, _mean = pipeline.predict_quantiles(
        inputs,
        prediction_length=prediction_length,
        quantile_levels=QUANTILE_LEVELS,
    )

    q = quantiles[0].detach().cpu().numpy()
    while q.ndim > 2:
        q = q[0]

    num_q = len(QUANTILE_LEVELS)
    if q.shape[0] == num_q and q.shape[1] != num_q:
        q = q.T
    elif q.shape[1] == num_q:
        pass
    else:
        raise ValueError(f"予期しない quantiles の形状: {tuple(quantiles[0].shape)}")

    idx = {level: i for i, level in enumerate(QUANTILE_LEVELS)}
    pred_low_80 = q[:, idx[0.1]]
    pred_low_50 = q[:, idx[0.25]]
    pred_median = q[:, idx[0.5]]
    pred_high_50 = q[:, idx[0.75]]
    pred_high_80 = q[:, idx[0.9]]

    if len(pred_median) != prediction_length:
        raise ValueError(f"予測長不一致: 期待 {prediction_length}, 実際 {len(pred_median)}")

    elapsed_ms = (time.perf_counter() - start_time) * 1000
    return {
        "context": context_values,
        "prediction_length": prediction_length,
        "median": pred_median.tolist(),
        "low_80": pred_low_80.tolist(),
        "high_80": pred_high_80.tolist(),
        "low_50": pred_low_50.tolist(),
        "high_50": pred_high_50.tolist(),
        "elapsed_ms": elapsed_ms,
        "x_values": x_values,
    }


# ============================================================
# API
# ============================================================
class PredictRequest(BaseModel):
    values: list[float]
    pred_len: int
    x_values: list | None = None


@app.get("/health")
def health():
    return {"status": "ok", "model": "amazon/chronos-2"}


@app.get("/model_info")
def model_info():
    return {
        "model": "amazon/chronos-2",
        "quantile_levels": QUANTILE_LEVELS,
        "device": "cpu",
    }


@app.post("/predict")
def predict(req: PredictRequest):
    if len(req.values) < 2:
        return {"error": "データが2点未満です"}
    if not (1 <= req.pred_len <= 200):
        return {"error": "予測ステップは1〜200の範囲で指定してください"}
    return run_forecast(req.values, req.pred_len, req.x_values)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8887)