
## Use local documentation:

The `go doc` command shows documentation for installed Go packages, use it.

1. **Check your go.mod** to find the packages being used.
2. **Use `go doc <package>`** to see a list of all functions, types, and structs in a package (e.g., `go doc net/http`).
3. **Use `-short` for brief descriptions** first, instead of full documentation.
4. **Use `go doc <package>.<symbol>`** to look up a specific function, type, or method (e.g., `go doc net/http.Request.Write`).
5. **Use `go doc -all <package>`** to see everything available, including unexported symbols and examples.
6. **Use `-src` to see source code** when documentation is unclear.
