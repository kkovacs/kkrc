

Now, do NOT implement it yourself, but write a spec out of this. Let me review it first. Then you will call a "subagent" to implement the spec this way (and you can even follow up with the subagent if you use the same `--session-id <job-name>` later):

```bash
pi --print --session-id <job-name> --model opencode-go/deepseek-v4-pro "$(cat "<your-spec.md>")"
```


