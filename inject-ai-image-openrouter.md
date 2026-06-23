

## Image gen/edit (OpenRouter + Recraft)

```bash
# ref is optional; drop the base64+image_url lines (and strength) to generate from scratch
base64 -w0 ref.webp > /tmp/b64   # omit for text-only gen
jq -n --rawfile b /tmp/b64 '{
  model:"recraft/recraft-v4.1", modalities:["image"],
  messages:[{role:"user", content:[
    {type:"text",      text:"prompt here"},
    {type:"image_url", image_url:{url:"data:image/webp;base64,\($b)"}}   # optional ref
  ]}],
  image_config:{
    aspect_ratio:"1:1",   # 1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9
    image_size:"1K",      # 1K|2K
    strength:0.5          # 0=keep refs → 1=ignore (only with input images)
  }
}' > /tmp/p.json

curl -s https://openrouter.ai/api/v1/chat/completions \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' \
  -d @/tmp/p.json \
  | jq -r '.choices[0].message.images[0].image_url.url' \
  | { read u; ext=.${u#data:image/}; ext=${ext%%;*}; echo "${u#*,}" | base64 -d > "out$ext"; }
```

- Compose: add more `image_url` entries and describe each by position ("image 1 = character, image 2 = scene"). `strength`: 0=keep refs → 1=ignore.
- List image capable models: `curl https://openrouter.ai/api/v1/images/models -H "Authorization: Bearer $OPENROUTER_API_KEY"`


