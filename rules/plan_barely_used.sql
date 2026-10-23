-- @id plan.barely_used
-- @title Paying for a plan you barely use
-- @pillar cost

WITH month AS (
  SELECT date_trunc('month', now()) AS lo,
         date_trunc('month', now()) + INTERVAL 1 MONTH AS hi
),
claude AS (
  SELECT
    (SELECT count(*) > 0 FROM turn_roots) AS has_data,
    (SELECT count(DISTINCT date_trunc('day', make_timestamp(t.start_ns // 1000)))
     FROM turn_roots t, month m
     WHERE make_timestamp(t.start_ns // 1000) >= m.lo
       AND make_timestamp(t.start_ns // 1000) < m.hi) AS days_used
),
anthropic_api AS (
  SELECT
    (SELECT count(*) > 0 FROM calls c
      WHERE lower(coalesce(c.provider, '')) LIKE '%anthropic%'
         OR starts_with(lower(coalesce(c.model_key, '')), 'claude-')) AS has_data,
    (SELECT count(DISTINCT date_trunc('day', make_timestamp(c.start_ns // 1000)))
     FROM calls c, month m
     WHERE make_timestamp(c.start_ns // 1000) >= m.lo AND make_timestamp(c.start_ns // 1000) < m.hi
       AND (lower(coalesce(c.provider, '')) LIKE '%anthropic%'
            OR starts_with(lower(coalesce(c.model_key, '')), 'claude-'))) AS days_used
),
openai_api AS (
  SELECT
    (SELECT count(*) > 0 FROM calls c
      WHERE lower(coalesce(c.provider, '')) LIKE '%openai%'
         OR starts_with(lower(coalesce(c.model_key, '')), 'gpt-')) AS has_data,
    (SELECT count(DISTINCT date_trunc('day', make_timestamp(c.start_ns // 1000)))
     FROM calls c, month m
     WHERE make_timestamp(c.start_ns // 1000) >= m.lo AND make_timestamp(c.start_ns // 1000) < m.hi
       AND (lower(coalesce(c.provider, '')) LIKE '%openai%'
            OR starts_with(lower(coalesce(c.model_key, '')), 'gpt-'))) AS days_used
),
google_api AS (
  SELECT
    (SELECT count(*) > 0 FROM calls c
      WHERE lower(coalesce(c.provider, '')) LIKE '%google%'
         OR lower(coalesce(c.provider, '')) LIKE '%gemini%'
         OR starts_with(lower(coalesce(c.model_key, '')), 'gemini-')) AS has_data,
    (SELECT count(DISTINCT date_trunc('day', make_timestamp(c.start_ns // 1000)))
     FROM calls c, month m
     WHERE make_timestamp(c.start_ns // 1000) >= m.lo AND make_timestamp(c.start_ns // 1000) < m.hi
       AND (lower(coalesce(c.provider, '')) LIKE '%google%'
            OR lower(coalesce(c.provider, '')) LIKE '%gemini%'
            OR starts_with(lower(coalesce(c.model_key, '')), 'gemini-'))) AS days_used
),
xai_api AS (
  SELECT
    (SELECT count(*) > 0 FROM calls c
      WHERE lower(coalesce(c.provider, '')) LIKE '%xai%'
         OR starts_with(lower(coalesce(c.model_key, '')), 'grok-')) AS has_data,
    (SELECT count(DISTINCT date_trunc('day', make_timestamp(c.start_ns // 1000)))
     FROM calls c, month m
     WHERE make_timestamp(c.start_ns // 1000) >= m.lo AND make_timestamp(c.start_ns // 1000) < m.hi
       AND (lower(coalesce(c.provider, '')) LIKE '%xai%'
            OR starts_with(lower(coalesce(c.model_key, '')), 'grok-'))) AS days_used
),
usage AS (
  SELECT 'claude_code' AS usage_kind, has_data, days_used FROM claude
  UNION ALL SELECT 'anthropic_api', has_data, days_used FROM anthropic_api
  UNION ALL SELECT 'openai_api', has_data, days_used FROM openai_api
  UNION ALL SELECT 'google_api', has_data, days_used FROM google_api
  UNION ALL SELECT 'xai_api', has_data, days_used FROM xai_api
)
SELECT
  CASE WHEN u.days_used = 0 THEN 'high' ELSE 'medium' END AS severity,
  'You paid ' || CASE WHEN monthly = round(monthly)
      THEN printf('$%.0f', monthly) ELSE printf('$%.2f', monthly) END
    || ' for ' || s.plan_name
    || ' and used it on ' || CAST(u.days_used AS INTEGER) || ' '
    || CASE WHEN u.days_used = 1 THEN 'day' ELSE 'days' END
    || ' this month' AS headline,
  monthly AS impact_value,
  'USD / month' AS impact_unit,
  CAST(u.days_used AS INTEGER) || ' days with traces Aftertrace can see this month. It only counts tools that send it telemetry.' AS detail,
  'Cancel or downgrade if you are not using it, or confirm the price on Plans if this is the wrong plan.' AS recommendation,
  '[]'::VARCHAR AS evidence,
  '[]'::VARCHAR AS sessions
FROM (
  SELECT s.*,
    CASE s.billing_period WHEN 'yearly' THEN s.price / 12.0 ELSE s.price END AS monthly
  FROM subscriptions s
) s
JOIN usage u ON u.usage_kind = s.usage_kind
WHERE s.status = 'active'
  AND s.billing_period IN ('monthly', 'yearly')
  AND s.price IS NOT NULL AND s.price > 0
  AND u.has_data
  AND u.days_used <= 3;
