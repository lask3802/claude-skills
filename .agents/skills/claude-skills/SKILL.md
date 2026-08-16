```markdown
# claude-skills Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches best practices and conventions for developing TypeScript projects in the `claude-skills` repository. It covers file and code organization, commit message standards, and testing patterns to ensure consistency and maintainability. While no specific framework is used, the repository emphasizes clear structure and conventional workflows.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `apiClient.ts`

### Import Style
- Use **relative imports** for referencing other modules.
  - Example:
    ```typescript
    import { fetchData } from './apiClient';
    ```

### Export Style
- Use **named exports** exclusively.
  - Example:
    ```typescript
    // In userProfile.ts
    export function getUserProfile(id: string) { ... }
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `feat` prefix for new features.
- Keep commit messages concise (average ~72 characters).
  - Example:
    ```
    feat: add user profile fetching logic to apiClient
    ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new feature or module  
**Command:** `/add-feature`

1. Create a new file using camelCase naming.
2. Write your TypeScript code, using named exports.
3. Import dependencies using relative paths.
4. Write corresponding test files with the `.test.ts` pattern.
5. Commit using the conventional format:
    ```
    feat: [short description of the feature]
    ```
6. Push your changes and open a pull request.

### Writing Tests
**Trigger:** When adding or updating code that requires testing  
**Command:** `/write-test`

1. Create a test file alongside your module, named as `moduleName.test.ts`.
2. Write your tests using the repository's preferred (but unspecified) testing framework.
3. Ensure all exports are tested.
4. Run tests to verify correctness.

### Refactoring Code
**Trigger:** When improving or restructuring existing code  
**Command:** `/refactor-code`

1. Identify the code to refactor.
2. Update the code, maintaining camelCase file naming and relative imports.
3. Update or add tests as needed.
4. Commit with a clear message (e.g., `feat: refactor user profile logic for clarity`).
5. Push and review changes.

## Testing Patterns

- Test files follow the `*.test.ts` naming convention.
- Place test files alongside the modules they test.
- The specific testing framework is not defined; use standard TypeScript testing practices.
- Example test file:
    ```typescript
    // userProfile.test.ts
    import { getUserProfile } from './userProfile';

    describe('getUserProfile', () => {
      it('should return user data for valid id', () => {
        // test implementation
      });
    });
    ```

## Commands
| Command         | Purpose                                      |
|-----------------|----------------------------------------------|
| /add-feature    | Start workflow for adding a new feature      |
| /write-test     | Begin writing tests for a module             |
| /refactor-code  | Refactor existing code following conventions |
```
