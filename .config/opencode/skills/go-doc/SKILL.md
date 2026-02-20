---
name: go-doc
description: Up-to-date Go pkg documentation using the go doc command
---

## When to use this skill

Use this skill when you need to:
- Understand how to use a Go package or library
- Look up function, type, or method signatures
- Explore available exports in a package
- Understand how to call a specific function
- Find up-to-date documentation for standard library or third-party packages

## Basic usage

The `go doc` command shows documentation for Go packages. Use the `bash` tool to execute this command.

## Best practices

1. **Check your go.mod** to find the third-party packages being used
2. **Use `go doc <package>`** to see a list of all functions, types, and structs in a package (e.g., `go doc net/http`)
3. **Use `-short` for brief descriptions** instead of full documentation
4. **Use `go doc <package>.<symbol>`** to look up a specific function, type, or method (e.g., `go doc net/http.Request.Write`)
5. **Use `go doc -all <package>`** to see everything available, including unexported symbols and examples
6. **Use `-src` to see source code** when documentation is unclear

