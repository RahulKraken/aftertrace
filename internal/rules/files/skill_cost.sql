-- @id skill.cost
-- @title Expensive skill
-- @pillar cost
-- @min_version 2.1.273

WITH tot AS (SELECT coalesce(sum(cost_usd), 0) AS total FROM llm),
skills AS (
  SELECT l.skill_name, sum(l.cost_usd) AS cost, count(*) AS n_req, mode(l.effort) AS effort, mode(l.model) AS model,
    (SELECT count(*) FROM events e WHERE e.name='skill_activated' AND a(e.attrs,'skill.name')=l.skill_name) AS acts
  FROM llm l WHERE l.skill_name IS NOT NULL GROUP BY l.skill_name
)
SELECT
  'medium' AS severity,
  'Skill ' || s.skill_name || ' drove ' || printf('%.0f', (s.cost / nullif(t.total,0)) * 100) || '% of spend' AS headline,
  s.cost AS impact_value,
  'USD' AS impact_unit,
  s.n_req || ' requests, ' || s.acts || ' activations, $' ||
    printf('%.2f', s.cost / greatest(1, s.acts)) || ' per activation. Mostly ' || coalesce(s.model, '?') ||
    ' at effort ' || coalesce(s.effort, 'none') || '.' AS detail,
  'Check whether ' || s.skill_name || ' needs ' || coalesce(s.model, 'this model') || ' at ' || coalesce(s.effort, 'this') ||
    ' effort. Try a lower effort level or a cheaper model for this skill and compare output.' AS recommendation,
  (SELECT to_json(list({'trace_id': trace_id, 'span_id': span_id, 'label': '$' || printf('%.3f', cost_usd)}
     ORDER BY cost_usd DESC))
   FROM (SELECT trace_id, span_id, cost_usd FROM llm WHERE skill_name=s.skill_name ORDER BY cost_usd DESC LIMIT 5))::VARCHAR AS evidence,
  (SELECT to_json(list(DISTINCT session_id)) FROM llm WHERE skill_name=s.skill_name)::VARCHAR AS sessions
FROM skills s, tot t
WHERE (t.total > 0 AND s.cost / t.total >= 0.25) OR (s.acts > 0 AND s.cost / s.acts >= 1.0) OR (s.acts = 0 AND s.cost >= 1.0);
