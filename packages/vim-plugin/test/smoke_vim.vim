scriptencoding utf-8
" Headless smoke test for the plain-Vim half of the plugin (job/channel transport,
" prop_add rendering). Run with:
"   vim -u DEFAULTS -N -Es -S packages/vim-plugin/test/smoke_vim.vim
" with PLV_LSP_SERVER_PATH, PLV_VIM_PLUGIN_DIR, PLV_FIXTURE_PACKAGE_JSON and
" PLV_RESULT_FILE set in the environment — see .github/workflows/ci.yml.
"
" It opens test/fixtures/workspace/package.json (useRegistry disabled) and waits
" for the plv-local-pkg line to get a real "plv_license" text property containing
" "MIT", the same annotation a real editor session would show. Every other
" dependency in that fixture is either missing from node_modules or would need a
" network request, so this stays deterministic without touching the network.

" prop_type_add() below references the 'Comment'/'String' highlight groups,
" which don't exist until the default color scheme is loaded.
runtime! syntax/syncolor.vim

let g:package_license_viewer_server_path = expand($PLV_LSP_SERVER_PATH)
let g:package_license_viewer_settings = {'npm': {'useRegistry': v:false}}

" Added to 'runtimepath' (rather than sourced directly) so the autoload/
" functions plugin/package_license_viewer.vim's autocmds call are actually
" discoverable, the same way a real plugin manager installs this plugin.
execute 'set runtimepath+=' . expand($PLV_VIM_PLUGIN_DIR)
runtime! plugin/package_license_viewer.vim
execute 'edit ' . expand($PLV_FIXTURE_PACKAGE_JSON)

function! s:HasMitAnnotation() abort
  for l in range(1, line('$'))
    for prop in prop_list(l, {'bufnr': bufnr('%')})
      if prop.type ==# 'plv_license' && prop.text =~# 'MIT'
        return 1
      endif
    endfor
  endfor
  return 0
endfunction

let s:deadline = reltime()
let s:ok = 0
while reltimefloat(reltime(s:deadline)) < 10.0
  sleep 100m
  if s:HasMitAnnotation()
    let s:ok = 1
    break
  endif
endwhile

call writefile([s:ok ? 'PASS' : 'FAIL'], expand($PLV_RESULT_FILE))
qall!
