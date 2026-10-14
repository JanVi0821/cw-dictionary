# Web app conventions

- Reuse compatible third-party components and libraries instead of rebuilding them.
- Use the existing icon library first; keep custom SVG icons in `src/components/icons/` and out of business code.
- Maintain shared `hooks`, `components`, `utils`, `layouts`, and `styles` modules under `src/`.
- Keep UI primitives in `src/components/ui/` and separate from business components.
- Organize every page in its own folder with page-only components beside it; respect framework-reserved route entry filenames.
- Prefer Tailwind; use module SCSS only when Tailwind is insufficient.
- Keep tests and test-only scripts under `test/`, never beside business code.
