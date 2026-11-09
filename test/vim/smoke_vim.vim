scriptencoding utf-8
" Headless smoke test for the plain-Vim half of the plugin (job/channel transport,
" prop_add rendering). Run with:
"   vim -u DEFAULTS -N -Es -S test/vim/smoke_vim.vim
" with the server built (npm run compile:lsp) and PLV_VIM_PLUGIN_DIR (the repo
" root), PLV_FIXTURE_PACKAGE_JSON and PLV_RESULT_FILE set in the environment —
" see .github/workflows/ci.yml.
"
" It opens test/fixtures/workspace/package.json (useRegistry disabled) and waits
" for the plv-local-pkg line to get a real "plv_license" text property containing
" "MIT", the same annotation a real editor session would show. Every other
" dependency in that fixture is either missing from node_modules or would need a
" network request, so this stays deterministic without touching the network.

" prop_type_add() below references the 'Comment'/'String' highlight groups,
" which don't exist until the default color scheme is loaded.
runtime! syntax/syncolor.vim

let g:package_license_viewer_settings = {'npm': {'useRegistry': v:false}}

" With PLV_PACKPATH set, the plugin is instead a fresh clone under
" $PLV_PACKPATH/pack/*/start/, loaded as a native package (|packages|) — and,
" with no server built there yet, this also covers the first-run auto-build.
if !empty($PLV_PACKPATH)
  execute 'set packpath^=' . expand($PLV_PACKPATH)
  packloadall
else
  " Added to 'runtimepath' (rather than sourced directly) so the autoload/
  " functions plugin/package_license_viewer.vim's autocmds call are actually
  " discoverable, the same way a real plugin manager installs this plugin.
  execute 'set runtimepath+=' . expand($PLV_VIM_PLUGIN_DIR)
  runtime! plugin/package_license_viewer.vim
endif
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
" PLV_TIMEOUT_SEC: long enough for the first-run npm ci + compile when PLV_PACKPATH is set
let s:timeout = empty($PLV_TIMEOUT_SEC) ? 10.0 : str2float($PLV_TIMEOUT_SEC)
while reltimefloat(reltime(s:deadline)) < s:timeout
  sleep 100m
  if s:HasMitAnnotation()
    let s:ok = 1
    break
  endif
endwhile

call writefile([s:ok ? 'PASS' : 'FAIL'], expand($PLV_RESULT_FILE))
qall!
