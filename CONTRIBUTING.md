# Contributing to OpenVolt

Thanks for your interest in contributing to OpenVolt!

## Getting Started

1. Fork the repository
2. Follow the [Quick Start](README.md#quick-start) to build locally
3. Create a feature branch: `git checkout -b feature/your-feature`
4. Make your changes
5. Run tests: `cd build && ctest`
6. Submit a pull request

## Development Setup

```bash
# Build in debug mode for development
cmake -B build -DCMAKE_BUILD_TYPE=Debug -DOPENVOLT_BUILD_PYTHON=ON
cmake --build build

# Run C++ tests
cd build && ctest --output-on-failure

# Frontend development
cd web && npm run dev

# API development
cd api && uvicorn app.main:app --reload --port 8000
```

## Code Style

- **C++**: Modern C++20, snake_case for functions/variables, PascalCase for types
- **Python**: Follow existing patterns, type hints required
- **TypeScript**: Follow existing patterns, no `any` types

## What to Contribute

- Bug fixes
- Performance improvements
- New risk models
- Tax policy implementations for additional jurisdictions
- UI improvements
- Documentation
- Test coverage

## Reporting Issues

- Use GitHub Issues
- Include: steps to reproduce, expected behavior, actual behavior
- For security issues, see [SECURITY.md](SECURITY.md)
