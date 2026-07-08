## Image gen/edit

```bash
# ref is optional; omit the input_references block to generate from scratch
base64 < ref.jpg | tr -d '\n' > /tmp/b64   # omit for text-only gen
jq -n --rawfile b /tmp/b64 '{
  model:"google/gemini-3.1-flash-lite-image",
  prompt:"prompt here",
  resolution:"1K",
  aspect_ratio:"1:1",  # 1:1|16:9|9:16|4:3|3:4|3:2|2:3|4:5|5:4
  input_references:[{  # optional reference image(s)
    type:"image_url",
    image_url:{url:"data:image/jpeg;base64,\($b)"}
  }]
}' > /tmp/p.json

curl -s -X POST https://openrouter.ai/api/v1/images \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' \
  -d @/tmp/p.json \
  | jq -r '.data[0].b64_json' \
  | base64 -d > out.jpg
```

- Compose/edit: add more `input_references` entries and describe each by position.
- OpenRouter image generation reference: <https://openrouter.ai/docs/guides/overview/multimodal/image-generation>
- List image capable models: `curl https://openrouter.ai/api/v1/images/models -H "Authorization: Bearer $OPENROUTER_API_KEY"`
