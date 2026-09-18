" package_license_viewer.vim - inline dependency license annotations
" Runs on plain Vim (8.1.1880+/9.x, via job + textprop) and on Neovim (via the lua/ layer, which takes over transport and rendering where Neovim can do strictly more — see doc/package_license_viewer.txt).

if exists('g:loaded_package_license_viewer')
  finish
endif
let g:loaded_package_license_viewer = 1

if !exists('g:package_license_viewer_enabled')
  let g:package_license_viewer_enabled = 1
endif

if !exists('g:package_license_viewer_node_command')
  let g:package_license_viewer_node_command = 'node'
endif

" Path to the bundled LSP server (dist/lspServer.js). Left unset by default so it is resolved lazily, relative to this plugin's own location — see package_license_viewer#ServerPath().
if !exists('g:package_license_viewer_server_path')
  let g:package_license_viewer_server_path = ''
endif

" Sent to the server as-is, nested exactly like the packageLicenseViewer.* settings VS Code has — e.g. {'npm': {'registry': 'https://registry.npmjs.org'}}. Empty by default, which just means every setting keeps the server's own defaults.
if !exists('g:package_license_viewer_settings')
  let g:package_license_viewer_settings = {}
endif

if has('nvim')
  " Neovim can do strictly more than plain Vim for transport (vim.lsp.start(), a real LSP client) and rendering (nvim_buf_set_extmark(), multi-colour virtual text in one mark), so the Lua layer owns both end to end instead of sharing the VimScript job/textprop path below — see doc/package_license_viewer.txt.
  command! PackageLicenseViewerToggle lua require('package_license_viewer').toggle()
  command! PackageLicenseViewerRefresh lua require('package_license_viewer').refresh()
  command! PackageLicenseViewerClearCache lua require('package_license_viewer').clear_cache()
  lua require('package_license_viewer').setup()
else
  command! PackageLicenseViewerToggle call package_license_viewer#Toggle()
  command! PackageLicenseViewerRefresh call package_license_viewer#Refresh()
  command! PackageLicenseViewerClearCache call package_license_viewer#ClearCache()

  augroup package_license_viewer
    autocmd!
    autocmd BufReadPost,BufNewFile,BufFilePost *.json,*.jsonc,Cargo.toml,pnpm-workspace.yaml,pnpm-workspace.yml
      \ call package_license_viewer#Attach()
    autocmd TextChanged,TextChangedI * call package_license_viewer#OnChange()
    autocmd BufWritePost * call package_license_viewer#OnChange()
    autocmd CursorHold,CursorMoved * call package_license_viewer#Hover()
    autocmd BufUnload * call package_license_viewer#Detach(str2nr(expand('<abuf>')))
    autocmd VimLeavePre * call package_license_viewer#Shutdown()
  augroup END
endif
