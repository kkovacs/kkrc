!pi -p -ne -ns -np --model opencode-go/minimax-m3 '
I need an expert "ponytail" senior architect code review. Do you see any:

- potential security issues?
- issues that might affect stability?
- change that might accidentally affect unrelated parts of the application?
- dangerous edge cases not covered?
- YAGNI: unrequested abstractions, "for later" scaffolding?
- code that could be simplified?
- bad practices, "code smells", duplicated code?
- tests testing less than they used to be, or test that are "fake"?

Review the code change in `git diff --cached`
'
