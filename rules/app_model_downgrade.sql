-- @id app.model_downgrade
-- @title A smaller model would do
-- @pillar cost
-- @min_version 0

-- An app operation that sends at least 10 calls to an Opus or Sonnet model and
-- gets short answers back (90% of outputs under 60 tokens): classification,
-- routing, extraction. Haiku usually handles these. Impact is what the same
-- tokens would have cost on claude-haiku-5-5.
WITH ops AS (
  SELECT service, operation, model,
    count(*) AS n, sum(cost_usd) AS cost,
    quantile_cont(output_tokens, 0.9) AS p90_out,
    sum(greatest(coalesce(input_tokens,0) - coalesce(cache_read_tokens,0) - coalesce(cache_write_tokens,0), 0)) AS in_uncached,
    sum(coalesce(cache_read_tokens,0)) AS in_read, sum(coalesce(cache_write_tokens,0)) AS in_write,
    sum(coalesce(output_tokens,0)) AS out_tok
  FROM calls
  WHERE NOT is_error AND (model_key LIKE 'claude-opus-%' OR model_key LIKE 'claude-sonnet-%' OR model_key LIKE 'claude-fable-%')
  GROUP BY 1, 2, 3
),
h AS (SELECT * FROM prices WHERE prefix = 'claude-haiku-5-5'),
scored AS (
  SELECT o.*, (o.in_uncached * h.input + o.in_write * h.cache_write + o.in_read * h.cache_read + o.out_tok * h.output) / 1e6 AS haiku_cost
  FROM ops o, h WHERE o.n >= 10 AND o.p90_out < 60
)
SELECT
  CASE WHEN s.cost - s.haiku_cost >= 5 THEN 'high' ELSE 'medium' END AS severity,
  s.service || ' · ' || s.operation || ' uses ' || s.model || ' for ' || CAST(round(s.p90_out) AS INTEGER) || '-token answers' AS headline,
  greatest(s.cost - s.haiku_cost, 0) AS impact_value,
  'USD' AS impact_unit,
  s.n || ' calls cost $' || printf('%.2f', s.cost) || '. 90% of answers are under ' || CAST(round(s.p90_out) AS INTEGER) ||
    ' tokens. The same tokens on claude-haiku-5-5 would cost $' || printf('%.2f', s.haiku_cost) || '.' AS detail,
  'Short, structured answers (labels, routes, yes/no) rarely need ' || s.model || '. Switch ' || s.operation ||
    ' to claude-haiku-5-5, run your own examples through both, and keep the bigger model only where the answers differ.' AS recommendation,
  (SELECT to_json(list({'trace_id': trace_id, 'span_id': span_id, 'label': coalesce(CAST(CAST(output_tokens AS INTEGER) AS VARCHAR), '?') || ' tokens out'}))
   FROM (SELECT trace_id, span_id, output_tokens FROM calls c
         WHERE c.service = s.service AND c.operation = s.operation AND c.model = s.model ORDER BY c.cost_usd DESC LIMIT 5))::VARCHAR AS evidence,
  '[]' AS sessions
FROM scored s
WHERE s.cost - s.haiku_cost > 0.01;
