std = "min"
-- Not read_globals: vim.g.<name> = value (setting a Vim global variable) is a normal write
-- through this table, not a mutation luacheck should flag.
globals = { "vim" }
-- Comments here follow the project's no-arbitrary-wrapping style (see CLAUDE.md / AGENTS.md),
-- so a fixed column limit would fight that instead of catching a real problem.
max_line_length = false
