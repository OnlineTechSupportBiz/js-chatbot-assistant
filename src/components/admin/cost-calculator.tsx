"use client";

import { useState } from "react";

/**
 * Standalone cost calculator: given a provider's per-1M-token input/output prices
 * and a token count, show the approximate dollar cost. Replaces the old baked-in
 * MODEL_PRICING estimate (which could not reflect custom/local providers).
 */
export function CostCalculator() {
  const [inputPrice, setInputPrice] = useState("0.40");
  const [outputPrice, setOutputPrice] = useState("1.60");
  const [inputTokens, setInputTokens] = useState("1000000");
  const [outputTokens, setOutputTokens] = useState("1000000");

  const ip = parseFloat(inputPrice) || 0;
  const op = parseFloat(outputPrice) || 0;
  const it = parseFloat(inputTokens) || 0;
  const ot = parseFloat(outputTokens) || 0;

  const cost = (it / 1_000_000) * ip + (ot / 1_000_000) * op;

  return (
    <div className="card">
      <h2>Cost calculator</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Estimate what a request will cost using your provider&apos;s price per 1M tokens. Leave a price blank to use $0.
      </p>
      <div className="form-row">
        <div className="field">
          <label className="label" htmlFor="cc-input-price">$ per 1M input tokens</label>
          <input className="input" id="cc-input-price" type="number" min="0" step="0.01" value={inputPrice} onChange={(e) => setInputPrice(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="cc-output-price">$ per 1M output tokens</label>
          <input className="input" id="cc-output-price" type="number" min="0" step="0.01" value={outputPrice} onChange={(e) => setOutputPrice(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="cc-input-tokens">Input tokens</label>
          <input className="input" id="cc-input-tokens" type="number" min="0" step="1000" value={inputTokens} onChange={(e) => setInputTokens(e.target.value)} />
        </div>
        <div className="field">
          <label className="label" htmlFor="cc-output-tokens">Output tokens</label>
          <input className="input" id="cc-output-tokens" type="number" min="0" step="1000" value={outputTokens} onChange={(e) => setOutputTokens(e.target.value)} />
        </div>
      </div>
      <div className="alert alert-info" style={{ marginTop: "0.75rem" }} role="alert">
        Estimated cost: <strong>${cost.toFixed(4)}</strong>
        {cost < 0.01 && it + ot > 0 ? " (less than a cent)" : ""} for {it.toLocaleString()} input + {ot.toLocaleString()} output tokens.
      </div>
    </div>
  );
}