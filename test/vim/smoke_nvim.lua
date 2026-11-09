-- Headless smoke test for the Neovim half of the plugin (vim.lsp.start() transport,
-- nvim_buf_set_extmark() rendering). Run with:
--   nvim --headless -u NONE --cmd "set rtp+=<repo>" \
--     -c "luafile test/vim/smoke_nvim.lua"
-- with the server built (npm run compile:lsp) and PLV_FIXTURE_PACKAGE_JSON and
-- PLV_RESULT_FILE set in the environment — see .github/workflows/ci.yml.
--
-- It opens test/fixtures/workspace/package.json (useRegistry disabled) and waits
-- for an extmark whose virtual text contains "MIT", the annotation plv-local-pkg
-- resolves to entirely from that fixture's local node_modules. Every other
-- dependency there is either missing from node_modules or would need a network
-- request, so this stays deterministic without touching the network.

vim.g.package_license_viewer_settings = { npm = { useRegistry = false } }

-- -u NONE turns off Neovim's automatic 'loadplugins' startup step, so
-- plugin/package_license_viewer.vim (added to 'runtimepath' by --cmd before
-- this file runs) needs to be sourced explicitly, the same way a real
-- plugin manager's automatic loading would have done it.
--
-- With PLV_PACKPATH set, the plugin is instead a fresh clone under
-- $PLV_PACKPATH/pack/*/start/, loaded as a native package (:help packages) — and,
-- with no server built there yet, this also covers the first-run auto-build.
local packpath = os.getenv("PLV_PACKPATH")
if packpath then
  vim.opt.packpath:prepend(packpath)
  vim.cmd("packloadall")
else
  vim.cmd("runtime! plugin/package_license_viewer.vim")
end

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
-- PLV_TIMEOUT_SEC: long enough for the first-run npm ci + compile when PLV_PACKPATH is set
local deadline = vim.loop.now() + (tonumber(os.getenv("PLV_TIMEOUT_SEC")) or 10) * 1000
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
