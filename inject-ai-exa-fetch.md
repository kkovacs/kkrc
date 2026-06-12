

## Fetch URLs contents with Exa when curl is blocked

You have the `EXA_API_KEY` env var.

```bash
curl -s -X POST 'https://api.exa.ai/contents' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://example.com"],
    "highlights": true                      # lowest token cost, good default
    # ,"highlights": {"query": "..."}       # targeted excerpts
    # ,"text": true
    # ,"text": {"maxCharacters": 5000}
    # ,"summary": {"query": "what is this?"}
    # ,"summary": {"query": "...", "schema": {"type":"object","properties":{...}}}
    # ,"maxAgeHours": 0                     # 0=livecrawl, -1=cache only, omit=default
    # ,"subpages": 10
    # ,"subpageTarget": ["docs", "api"]
  }'
```


