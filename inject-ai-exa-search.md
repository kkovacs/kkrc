

## Web search with Exa API

You have the `EXA_API_KEY` env var.

```bash
curl -s -X POST 'https://api.exa.ai/search' \
  -H "x-api-key: $EXA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "describe the ideal page, not keywords",
    "type": "auto",                          # auto|fast|instant|deep-lite|deep
    "contents": {"highlights": true}         # true or {"query": "..."} for targeted
    # ,"numResults": 10
    # ,"category": "company"                 # company|research paper|news|personal site|people|financial report
    # ,"includeDomains": ["arxiv.org"]
    # ,"excludeDomains": ["reddit.com"]
    # ,"startPublishedDate": "2025-01-01"
    # ,"endPublishedDate": "2025-06-01"
    # ,"outputSchema": {"type":"object","properties":{...}}  # structured JSON, best with deep
  }'
```


