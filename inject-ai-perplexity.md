

## Web research via Perplexity Sonar on OpenRouter

You have `$OPENROUTER_API_KEY` in the environment.

```bash
curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "perplexity/sonar-pro",         # "perplexity/sonar" for quick/cheap, "perplexity/sonar-pro" for deeper research
    "messages": [{"role": "user", "content": "describe what you need, not keywords"}]
    # ,"search_recency_filter": "week"       # "day" | "week" | "month"
    # ,"search_domain_filter": ["docs.python.org", "wikipedia.org"]
  }'
```


