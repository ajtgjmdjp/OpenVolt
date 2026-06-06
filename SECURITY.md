# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Email: [security contact via GitHub private vulnerability reporting]
3. Or use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)

## Scope

OpenVolt is a local-first portfolio optimization tool. Security considerations include:

- **Workspace file access**: Path traversal prevention in artifact storage
- **API input validation**: Bounded inputs for sweep/Monte Carlo parameters
- **API key handling**: Keys read from environment variables only, never stored in code
- **Error messages**: Sanitized to prevent information leakage

## Design Principles

- No secrets in source code
- API keys via environment variables only
- Parameterized SQL queries (no string interpolation)
- Path traversal protection on all file operations
- Input validation with Pydantic schemas
- Apache-2.0 ensures transparency
