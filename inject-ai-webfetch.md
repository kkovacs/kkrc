

## Web fetch options

Here are some alternatives to curl.

### markdown.new (fast, simple, CloudFlare)

```bash
curl -s "https://markdown.new/<url>"
```

Converts webpage to markdown for easier digest and much smaller size.

### Exa - if `$EXA_API_KEY` is set (paid, clean, has summary and schema)

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

### Jina Reader (slower, rate-limited, but has "links" and "images-summary")

```bash
curl -s "https://r.jina.ai/<url>" \
  -H "Accept: text/markdown" \
  -H "X-No-Cache: true" \
  # ,"X-Target-Selector": "h1, p:first-of-type"   # CSS-selector targeting
  # ,"X-Return-Format": "markdown"                # default
  # ,"X-With-Generated-Alt": "true"               # alt text for images
  # ,"X-With-Links-Summary": "true"               # append links list
  # ,"X-With-Images-Summary": "true"              # append images list
  # ,"X-Token-Budget": "20000"                    # hard cap on response tokens
```

Response carries `x-usage-tokens: <n>`. Speed: ~1.5 s static, ~3-7 s SPAs.


