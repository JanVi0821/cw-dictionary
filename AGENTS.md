<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->

# Frontend conventions

- Prefer `@douyinfe/semi-ui-19` for UI. When Semi already has a component for the interaction, use that component instead of building one.
- Reuse compatible third-party components and libraries instead of rebuilding them.
- Use the existing icon library first; keep custom SVG icons in the shared icon directory and out of business code.
- Maintain shared `hooks`, `components`, `utils`, `layouts`, and `styles` modules under `src/`.
- Keep UI primitives in `components/ui/` and separate from business components.
- Organize every page in its own folder with page-only components beside it; respect framework-reserved route entry filenames.
- Prefer Tailwind; use module SCSS only when Tailwind is insufficient.
- Keep tests and test-only scripts under root `test/`, never beside business code.
