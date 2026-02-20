# Contributing to KubeLab

Thank you for your interest in contributing to KubeLab! This document provides guidelines and instructions for contributing.

## How to Contribute

### Reporting Bugs

If you find a bug, please open an issue with:
- **Description**: Clear description of the bug
- **Steps to Reproduce**: Step-by-step instructions
- **Expected Behavior**: What should happen
- **Actual Behavior**: What actually happens
- **Environment**: Kubernetes version, OS, etc.
- **Screenshots**: If applicable

### Suggesting Features

Feature suggestions are welcome! Please open an issue with:
- **Use Case**: Why this feature would be useful
- **Proposed Solution**: How you envision it working
- **Alternatives**: Other approaches you've considered

### Pull Requests

1. **Fork the repository**
2. **Create a feature branch**: `git checkout -b feature/your-feature-name`
3. **Make your changes**: Follow the coding standards below
4. **Test your changes**: Ensure all scripts work and tests pass
5. **Commit your changes**: Use clear, descriptive commit messages
6. **Push to your fork**: `git push origin feature/your-feature-name`
7. **Open a Pull Request**: Provide a clear description of your changes

## Coding Standards

### Code Style

- **JavaScript/Node.js**: Follow ESLint configuration (if present)
- **YAML**: Use 2 spaces for indentation
- **Bash**: Use 2 spaces for indentation, add shebang `#!/bin/bash`

### Commit Messages

Use clear, descriptive commit messages:
- Start with a verb: "Add", "Fix", "Update", "Remove"
- Be specific: "Fix pod deletion error handling" not "Fix bug"
- Reference issues: "Fix #123: Pod deletion error"

### Documentation

- Update relevant documentation files
- Add comments for non-obvious code
- Update README if adding new features

## Development Setup

1. Clone the repository
2. Set up a local Kubernetes cluster (MicroK8s, minikube, or kind)
3. Build Docker images: `./scripts/build-and-push.sh`
4. Deploy: `./scripts/deploy-all.sh`
5. Test: `./scripts/smoke-test.sh`

## Testing

Before submitting a PR:
- Run all deployment scripts successfully
- Verify frontend and backend work correctly
- Test failure simulations
- Check that Grafana dashboards load
- Ensure no linter errors

## Areas for Contribution

- **New Failure Scenarios**: Add more simulation types
- **UI Improvements**: Enhance the frontend dashboard
- **Documentation**: Improve guides and tutorials
- **Performance**: Optimize API calls and resource usage
- **Security**: Enhance security configurations
- **Observability**: Add more metrics and dashboards

## Questions?

If you have questions, please:
- Open an issue with the `question` label
- Check existing issues and documentation first

Thank you for contributing to KubeLab! 🚀
