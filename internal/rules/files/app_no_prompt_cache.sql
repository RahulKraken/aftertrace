-- @id app.no_prompt_cache
-- @title Prompt caching is off
-- @pillar cost
-- @min_version 0

-- An Anthropic operation with at least 10 calls averaging over 2,000 input
-- tokens and no cache reads at all. If the calls share a long prefix (system
-- prompt, tools, documents), caching it bills repeat reads at a tenth of the
-- input price. Impact is the most it could save: 90% of the input cost after
-- the first call, assuming the whole input repeats. Real savings are lower.
WITH ops AS (
  SELECT service, operation, model, count(*) AS n, avg(input_tokens) AS avg_in,
    sum(coalesce(cache_read_tokens, 0)) AS reads, sum(coalesce(cache_write_tokens, 0)) AS writes,
    sum(input_tokens) AS in_tok, any_value(model_key) AS mk
  FROM calls
  WHERE NOT is_error AND (provider = 'anthropic' OR model_key LIKE 'claude-%')
  GROUP BY 1, 2, 3
),
priced AS (
  SELECT o.*, (SELECT p.input FROM prices p WHERE starts_with(o.mk, p.prefix) ORDER BY length(p.prefix) DESC LIMIT 1) AS in_price
  FROM ops o WHERE o.n >= 10 AND o.avg_in > 2000 AND o.reads = 0 AND o.writes = 0
)
SELECT
  'low' AS severity,
  p.service || ' · ' || p.operation || ' resends ~' || CAST(round(p.avg_in / 100) * 100 AS INTEGER) || ' input tokens per call with no prompt caching' AS headline,
  p.in_tok * (p.n - 1) / p.n * p.in_price * 0.9 / 1e6 AS impact_value,
  'USD at most' AS impact_unit,
  p.n || ' calls to ' || p.model || ', ' || CAST(round(p.avg_in) AS INTEGER) || ' input tokens on average, zero cache reads.' AS detail,
  'Mark the stable part of the prompt (system prompt, tool definitions, reference documents) with cache_control, and put anything that changes per call after it. Check gen_ai.usage.cache_read.input_tokens afterwards; if it stays zero, something early in the prompt is changing.' AS recommendation,
  (SELECT to_json(list({'trace_id': trace_id, 'span_id': span_id, 'label': CAST(CAST(input_tokens AS INTEGER) AS VARCHAR) || ' tokens in'}))
   FROM (SELECT trace_id, span_id, input_tokens FROM calls c WHERE c.service = p.service AND c.operation = p.operation AND c.model = p.model
         ORDER BY c.input_tokens DESC LIMIT 5))::VARCHAR AS evidence,
  '[]' AS sessions
FROM priced p
WHERE p.in_price IS NOT NULL;
