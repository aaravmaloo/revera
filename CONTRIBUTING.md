# Contributing to Aevix

Thank you for your interest in Aevix! Contributions from the community help make this package reputation engine a standard developer tool.

## Setup Instructions

1. **Fork the repository** on GitHub.
2. **Clone the repository** to your local machine:
   ```bash
   git clone https://github.com/your-username/aevix.git
   cd aevix
   ```
3. **Install dependencies** using npm (ensure you have Node v22+):
   ```bash
   npm install
   ```
4. **Compile TypeScript** in watch mode:
   ```bash
   npm run dev
   ```

## Development and Testing

Aevix is written in TypeScript and uses Vitest for testing.

- **Running Tests**: Verify your changes against the test suite.
  ```bash
  npm test
  ```
- **Code Style**: Ensure code is formatted correctly using Prettier.
  ```bash
  npm run format
  ```
- **Linting**: Check for styling and pattern issues.
  ```bash
  npm run lint
  ```

## Submitting Pull Requests

1. Create a new branch named with your feature or bug description (e.g. `feat/osv-api-enrichment`).
2. Make your changes, write tests, and run `npm test` to verify everything is green.
3. Commit your changes with clear messages.
4. Push your branch and open a Pull Request. Provide a clear description of your changes and why they are necessary.

## Code of Conduct

Please note that we have a [Code of Conduct](./CODE_OF_CONDUCT.md). Participate respectfully in issues, PRs, and discussions.
