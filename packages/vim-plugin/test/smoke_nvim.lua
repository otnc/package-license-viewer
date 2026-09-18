-- Headless smoke test for the Neovim half of the plugin (vim.lsp.start() transport,
-- nvim_buf_set_extmark() rendering). Run with:
--   nvim --headless -u NONE --cmd "set rtp+=<repo>/packages/vim-plugin" \
--     -c "luafile packages/vim-plugin/test/smoke_nvim.lua"
-- with PLV_LSP_SERVER_PATH, PLV_FIXTURE_PACKAGE_JSON and PLV_RESULT_FILE set in
-- the environment — see .github/workflows/ci.yml.
--
-- It opens test/fixtures/workspace/package.json (useRegistry disabled) and waits
-- for an extmark whose virtual text contains "MIT", the annotation plv-local-pkg
-- resolves to entirely from that fixture's local node_modules. Every other
-- dependency there is either missing from node_modules or would need a network
-- request, so this stays deterministic without touching the network.

vim.g.package_license_viewer_server_path = os.getenv("PLV_LSP_SERVER_PATH")
vim.g.package_license_viewer_settings = { npm = { useRegistry = false } }

-- -u NONE turns off Neovim's automatic 'loadplugins' startup step, so
-- plugin/package_license_viewer.vim (added to 'runtimepath' by --cmd before
-- this file runs) needs to be sourced explicitly, the same way a real
-- plugin manager's automatic loading would have done it.
vim.cmd("runtime! plugin/package_license_viewer.vim")

vim.cmd("edit " .. os.getenv("PLV_FIXTURE_PACKAGE_JSON"))

-- Same name the plugin's own require("package_license_viewer") creates its namespace
-- with, so this resolves to the identical id rather than a fresh, unused one.
local ns = vim.api.nvim_create_namespace("package_license_viewer")
local bufnr = vim.api.nvim_get_current_buf()

local function has_mit_annotation()
  local marks = vim.api.nvim_buf_get_extmarks(bufnr, ns, 0, -1, { details = true })
  for _, mark in ipairs(marks) do
    local details = mark[4]
    if details and details.virt_text then
      for _, chunk in ipairs(details.virt_text) do
        if chunk[1]:find("MIT", 1, true) then
          return true
        end
      end
    end
  end
  return false
end

local ok = false
local deadline = vim.loop.now() + 10000
while vim.loop.now() < deadline do
  vim.wait(100)
  if has_mit_annotation() then
    ok = true
    break
  end
end

local f = io.open(os.getenv("PLV_RESULT_FILE"), "w")
f:write(ok and "PASS" or "FAIL")
f:close()

vim.cmd("qa!")
