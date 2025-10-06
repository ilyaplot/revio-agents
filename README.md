# TheRevio Agents

Unified repository for TheRevio code review agents supporting both GitHub Actions and Bitbucket Pipelines.

## Architecture

This repository contains a single codebase with two entry points:

- **GitHub Actions Agent** (`index-github.ts`) - For GitHub pull requests
- **Bitbucket Pipelines Agent** (`index-bitbucket.ts`) - For Bitbucket pull requests

Both agents share the same core services:
- WebSocket communication with TheRevio backend
- Git diff analysis
- File system operations
- Dependency detection

## Docker Images

Two Docker images are built from this repository:

- `ilyaplot/revio-agent-github:latest` - GitHub Actions agent
- `ilyaplot/revio-agent-bitbucket:latest` - Bitbucket Pipelines agent

Both images are tagged with the same version number for consistency.

## Usage

### GitHub Actions

```yaml
name: TheRevio Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  code-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: ilyaplot/revio-agents@latest
        with:
          backend_url: wss://therevio.com
          api_key: ${{ secrets.THEREVIO_API_KEY }}
          github_token: ${{ github.token }}
```

### Bitbucket Pipelines

```yaml
pipelines:
  pull-requests:
    '**':
      - step:
          name: TheRevio Code Review
          image: ilyaplot/revio-agent-bitbucket:latest
          script:
            - echo "TheRevio agent runs automatically"
          services:
            - docker
```

## Development

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

### Run Locally

```bash
# GitHub agent
npm run dev:github

# Bitbucket agent
npm run dev:bitbucket
```

### Test

```bash
npm test
```

### Build Docker Images

```bash
# GitHub agent
docker build -f Dockerfile.github -t revio-agent-github:dev .

# Bitbucket agent
docker build -f Dockerfile.bitbucket -t revio-agent-bitbucket:dev .
```

## Environment Variables

### GitHub Actions

- `BACKEND_URL` - TheRevio backend WebSocket URL
- `THEREVIO_API_KEY` - API key from TheRevio UI
- `GITHUB_TOKEN` - GitHub token for API access
- `GITHUB_REPOSITORY` - Repository (owner/repo)
- `GITHUB_SHA` - Commit SHA
- `GITHUB_REF` - Git ref
- `GITHUB_HEAD_REF` - PR source branch
- `GITHUB_BASE_REF` - PR target branch
- `DEBUG` - Enable debug logging (0 or 1)

### Bitbucket Pipelines

- `BACKEND_URL` - TheRevio backend WebSocket URL
- `THEREVIO_API_KEY` - API key from TheRevio UI
- `BITBUCKET_WORKSPACE` - Workspace slug
- `BITBUCKET_REPO_SLUG` - Repository slug
- `BITBUCKET_PR_ID` - Pull request ID
- `BITBUCKET_COMMIT` - Commit SHA
- `BITBUCKET_BRANCH` - Source branch
- `BITBUCKET_PR_DESTINATION_BRANCH` - Target branch
- `DEBUG` - Enable debug logging (0 or 1)

## License

MIT
