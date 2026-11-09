-- Neovim's half of the plugin. Neovim can do strictly more than plain Vim here, so this replaces the VimScript transport (job/channel) and rendering (prop_add) entirely instead of sharing them: vim.lsp.start() is a real LSP client (didOpen/didChange/version tracking, hover merged with any other attached client, all handled for us), and nvim_buf_set_extmark() puts every coloured segment of one annotation in a single mark instead of the three separate text properties the Vim side needs.

local M = {}

local ns = vim.api.nvim_create_namespace("package_license_viewer")
local client_id = nil

local building = false
local build_failed = false
local waiting = {} -- bufnr -> true, attached once the build below finishes

local function server_cmd()
  return {
    vim.g.package_license_viewer_node_command or "node",
    vim.fn["package_license_viewer#ServerPath"](),
    "--stdio",
  }
end

local function on_built()
  building = false
  local bufs = waiting
  waiting = {}
  for bufnr in pairs(bufs) do
    if vim.api.nvim_buf_is_loaded(bufnr) then
      M.attach(bufnr)
    end
  end
end

-- Same steps as plain Vim's (autoload/package_license_viewer.vim), run one after another in the repository root: on first use, and again after a plugin manager update leaves the bundle older than its sources.
local function build(steps)
  building = true
  local root = vim.fn["package_license_viewer#Root"]()
  local function on_exit(_, code)
    if code ~= 0 then
      building = false
      build_failed = true
      vim.notify(
        ("package_license_viewer: `%s` failed (exit %d) in %s"):format(table.concat(steps[1], " "), code, root),
        vim.log.levels.ERROR
      )
    elseif #steps > 1 then
      build(vim.list_slice(steps, 2))
    else
      on_built()
    end
  end
  -- e.g. npm not installed: jobstart() returns -1 and on_exit never comes
  if vim.fn.jobstart(steps[1], { cwd = root, on_exit = on_exit }) <= 0 then
    on_exit(nil, -1)
  end
end

local function on_annotations(_, result, _)
  if not result or not result.uri then
    return
  end
  local bufnr = vim.uri_to_bufnr(result.uri)
  if not vim.api.nvim_buf_is_loaded(bufnr) then
    return
  end
  vim.api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
  local total_lines = vim.api.nvim_buf_line_count(bufnr)
  for _, entry in ipairs(result.entries or {}) do
    local segs = entry.segments
    if segs and entry.line >= 0 and entry.line < total_lines then
      local virt_text = {}
      if segs.before ~= "" then
        table.insert(virt_text, { "  " .. segs.before, "Comment" })
      end
      if segs.license ~= "" then
        local pad = segs.before == "" and "  " or ""
        table.insert(virt_text, { pad .. segs.license, "String" })
      end
      if segs.after ~= "" then
        table.insert(virt_text, { segs.after, "Comment" })
      end
      if #virt_text > 0 then
        vim.api.nvim_buf_set_extmark(bufnr, ns, entry.line, 0, {
          virt_text = virt_text,
          virt_text_pos = "eol",
        })
      end
    end
  end
end

--- Starts (or reuses) the language server and attaches the given buffer to it.
function M.attach(bufnr)
  if vim.g.package_license_viewer_enabled == 0 or build_failed then
    return
  end
  if building or vim.fn["package_license_viewer#NeedsBuild"]() == 1 then
    waiting[bufnr] = true
    if not building then
      vim.notify("package_license_viewer: building the language server (first run or after an update)...")
      build(vim.fn["package_license_viewer#BuildSteps"]())
    end
    return
  end
  client_id = vim.lsp.start({
    name = "package_license_viewer",
    cmd = server_cmd(),
    root_dir = vim.fn.getcwd(),
    -- vim.lsp.start() sends this as workspace/didChangeConfiguration on attach for us; nested exactly like the packageLicenseViewer.* settings VS Code has, e.g. { npm = { registry = "..." } }.
    settings = vim.g.package_license_viewer_settings or {},
    handlers = {
      ["packageLicenseViewer/annotations"] = on_annotations,
    },
  }, {
    bufnr = bufnr,
    reuse_client = function(client, config)
      return client.name == config.name
    end,
  })
end

function M.toggle()
  vim.g.package_license_viewer_enabled = (vim.g.package_license_viewer_enabled == 0) and 1 or 0
  if vim.g.package_license_viewer_enabled == 0 then
    if client_id then
      for _, bufnr in ipairs(vim.lsp.get_buffers_by_client_id(client_id)) do
        vim.api.nvim_buf_clear_namespace(bufnr, ns, 0, -1)
      end
    end
  else
    M.attach(vim.api.nvim_get_current_buf())
  end
end

--- Neovim's LSP client tracks document versions itself and has no public "resend didChange" API, so a forced refresh restarts the server (dropping its in-memory license cache too) and re-attaches — simple, and rare enough to not matter that it is not the cheapest option.
function M.clear_cache()
  if client_id then
    vim.lsp.stop_client(client_id, true)
    client_id = nil
  end
end

function M.refresh()
  local bufnr = vim.api.nvim_get_current_buf()
  M.clear_cache()
  M.attach(bufnr)
end

function M.setup()
  if vim.g.package_license_viewer_enabled == nil then
    vim.g.package_license_viewer_enabled = 1
  end
  if vim.g.package_license_viewer_node_command == nil then
    vim.g.package_license_viewer_node_command = "node"
  end
  if vim.g.package_license_viewer_settings == nil then
    vim.g.package_license_viewer_settings = {}
  end

  local group = vim.api.nvim_create_augroup("package_license_viewer", { clear = true })
  vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
    group = group,
    pattern = {
      "*.json",
      "*.jsonc",
      "Cargo.toml",
      "pnpm-workspace.yaml",
      "pnpm-workspace.yml",
      "moon.mod",
      "go.mod",
      "Gemfile",
      "*.gemspec",
    },
    callback = function(args)
      M.attach(args.buf)
    end,
  })
end

return M
