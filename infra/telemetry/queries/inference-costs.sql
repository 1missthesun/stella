WITH deduped AS (
  SELECT DISTINCT
    event_id,
    source,
    provider,
    model,
    success,
    input_tokens,
    output_tokens,
    reasoning_tokens,
    cached_input_tokens,
    cost_micro_cents,
    duration_ms
  FROM telemetry.events_v1
  WHERE event_type = 'inference.completed'
    AND (source = 'cloud-builder' OR provider <> 'stella')
    AND __ingest_ts >= TIMESTAMP '{{START_UTC}}'
    AND __ingest_ts < TIMESTAMP '{{END_UTC}}'
)
SELECT
  source,
  provider,
  model,
  success,
  COUNT(*) AS inference_count,
  SUM(input_tokens) AS input_tokens,
  SUM(output_tokens) AS output_tokens,
  SUM(reasoning_tokens) AS reasoning_tokens,
  SUM(cached_input_tokens) AS cached_input_tokens,
  SUM(cost_micro_cents) / 100000000.0 AS cost_usd,
  AVG(duration_ms) AS average_duration_ms
FROM deduped
GROUP BY source, provider, model, success
ORDER BY cost_usd DESC
LIMIT 500;
