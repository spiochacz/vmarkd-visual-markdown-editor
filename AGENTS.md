When finishing implementation, always update task status inside the relevant `tasks/` file: tick checklist items that were implemented and flag what isn't ready yet. The task file is the single source of truth for status.

`tasks/README.md` is an informative index, not a status tracker — do not record partial or in-progress status there. Only update `tasks/README.md` when a task is fully complete, to mark it done.

Every new piece of functionality must ship with **unit tests and e2e tests**, and you must **verify the coverage** for it (run the coverage report and confirm the new code is exercised). A task is not done until its tests pass and cover the new behaviour.

**Read [`DEVELOPMENT.md`](DEVELOPMENT.md) before writing or changing code or tests.** It documents the build layout, the two test layers (vitest + Playwright), how the harnesses and mocks work, how to add a test in each layer, and how to check coverage.
