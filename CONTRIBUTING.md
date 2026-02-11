# Contributing to Procura

Thank you for your interest in contributing! Here's how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/tinotruppel/procura.git
cd procura

# Frontend (Extension + PWA)
cd frontend && npm install && npm run dev

# Backend
cd backend && npm install && cp .env.example .env && npm run dev:node
```

## Code Standards

- **Language**: TypeScript (strict mode)
- **Formatting**: 4 spaces, LF line endings, double quotes (see `.editorconfig`)
- **Comments, logs, tests**: English
- **Linting**: ESLint — `npx eslint src/`

## Making Changes

1. Fork the repo and create a feature branch from `main`
2. Make small, focused commits with descriptive messages
3. Add or update tests for your changes
4. Run the full test suite before submitting:
   ```bash
   bash scripts/test-all.sh
   ```
5. Open a Pull Request with a clear description of what and why

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Include test coverage for new functionality
- Update documentation if you change public APIs or behavior
- Don't include unrelated formatting changes

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
