scriptencoding utf-8
" Vim's half of the plugin: a minimal LSP client over job/channel, and rendering with prop_add()/popup_atcursor(). Not used on Neovim — see plugin/package_license_viewer.vim and lua/package_license_viewer/init.lua, which replace this entirely with vim.lsp.start() and nvim_buf_set_extmark().

let s:job = v:null
let s:channel = v:null
let s:recv_buffer = ''
let s:next_id = 1
let s:pending = {}
let s:server_initialized = 0
let s:init_queue = []
let s:change_timer = -1
" bufnr -> {'uri': string, 'version': number}
let s:attached = {}
let s:prop_types_ready = 0

function! s:EnsurePropTypes() abort
  if s:prop_types_ready
    return
  endif
  let s:prop_types_ready = 1
  call prop_type_add('plv_before', {'highlight': 'Comment'})
  call prop_type_add('plv_license', {'highlight': 'String'})
  call prop_type_add('plv_after', {'highlight': 'Comment'})
endfunction

" ---- transport --------------------------------------------------------------

function! package_license_viewer#ServerPath() abort
  if !empty(g:package_license_viewer_server_path)
    return g:package_license_viewer_server_path
  endif
  " packages/vim-plugin/autoload/ -> packages/vim-plugin/ -> packages/ -> packages/lsp-server/dist/lspServer.js
  let here = expand('<script>:p:h')
  return simplify(here . '/../../lsp-server/dist/lspServer.js')
endfunction

function! s:EnsureServer() abort
  if s:job isnot v:null && job_status(s:job) ==# 'run'
    return
  endif
  call s:EnsurePropTypes()
  let cmd = [g:package_license_viewer_node_command, package_license_viewer#ServerPath(), '--stdio']
  let s:recv_buffer = ''
  let s:server_initialized = 0
  let s:job = job_start(cmd, {
    \ 'in_mode': 'raw',
    \ 'out_mode': 'raw',
    \ 'err_mode': 'nl',
    \ 'out_cb': function('s:OnOut'),
    \ 'err_cb': function('s:OnErr'),
    \ 'exit_cb': function('s:OnExit'),
    \ })
  if job_status(s:job) !=# 'run'
    echohl ErrorMsg
    echom 'package_license_viewer: failed to start ' . string(cmd)
    echohl None
    return
  endif
  let s:channel = job_getchannel(s:job)
  call s:SendRequest('initialize', {
    \ 'processId': getpid(),
    \ 'rootUri': v:null,
    \ 'capabilities': {},
    \ 'initializationOptions': {'settings': g:package_license_viewer_settings},
    \ }, function('s:OnInitializeResponse'))
endfunction

function! s:OnInitializeResponse(response) abort
  let s:server_initialized = 1
  call s:SendNotification('initialized', {})
  let queue = s:init_queue
  let s:init_queue = []
  for Fn in queue
    call Fn()
  endfor
endfunction

function! s:OnErr(channel, msg) abort
  " The server's own stderr (its console.error-based logger) — surfaced for debugging only.
  call ch_log('package_license_viewer: ' . a:msg)
endfunction

function! s:OnExit(job, status) abort
  let s:job = v:null
  let s:channel = v:null
  let s:server_initialized = 0
endfunction

function! s:SendMessage(msg) abort
  if s:job is v:null
    return
  endif
  let body = json_encode(a:msg)
  let header = "Content-Length: " . len(body) . "\r\n\r\n"
  call ch_sendraw(s:channel, header . body)
endfunction

function! s:SendRequest(method, params, callback) abort
  let id = s:next_id
  let s:next_id += 1
  let s:pending[id] = a:callback
  call s:SendMessage({'jsonrpc': '2.0', 'id': id, 'method': a:method, 'params': a:params})
endfunction

function! s:SendNotification(method, params) abort
  call s:SendMessage({'jsonrpc': '2.0', 'method': a:method, 'params': a:params})
endfunction

" Runs `Fn` now if the server has already answered `initialize`, or once it does.
function! s:AfterInit(Fn) abort
  if s:server_initialized
    call a:Fn()
  else
    call add(s:init_queue, a:Fn)
  endif
endfunction

function! s:OnOut(channel, msg) abort
  let s:recv_buffer .= a:msg
  call s:DrainMessages()
endfunction

function! s:DrainMessages() abort
  while 1
    let header_end = stridx(s:recv_buffer, "\r\n\r\n")
    if header_end == -1
      return
    endif
    let header = strpart(s:recv_buffer, 0, header_end)
    let m = matchlist(header, 'Content-Length:\s*\(\d\+\)')
    if empty(m)
      let s:recv_buffer = ''
      return
    endif
    let length = str2nr(m[1])
    let body_start = header_end + 4
    if len(s:recv_buffer) < body_start + length
      return
    endif
    let body = strpart(s:recv_buffer, body_start, length)
    let s:recv_buffer = strpart(s:recv_buffer, body_start + length)
    call s:HandleMessage(json_decode(body))
  endwhile
endfunction

function! s:HandleMessage(msg) abort
  if has_key(a:msg, 'id') && has_key(a:msg, 'method')
    " a request from the server; nothing here needs to answer one
    return
  endif
  if has_key(a:msg, 'id')
    let id = a:msg.id
    if has_key(s:pending, id)
      let Callback = s:pending[id]
      call remove(s:pending, id)
      call Callback(a:msg)
    endif
    return
  endif
  if get(a:msg, 'method', '') ==# 'packageLicenseViewer/annotations'
    call s:ApplyAnnotations(a:msg.params)
  endif
endfunction

" ---- documents ---------------------------------------------------------------

function! s:UriFromPath(path) abort
  let p = substitute(a:path, '\\', '/', 'g')
  if p =~# '^[A-Za-z]:/'
    let p = '/' . p
  endif
  " '%' has to be escaped first so it doesn't re-encode the '%20' this also
  " introduces for spaces — a literal '%' left as-is breaks the server's
  " decodeURIComponent() round-trip (e.g. a "100%done" directory name).
  let p = substitute(p, '%', '%25', 'g')
  return 'file://' . substitute(p, ' ', '%20', 'g')
endfunction

function! s:PathFromUri(uri) abort
  let p = substitute(a:uri, '^file://', '', '')
  let p = substitute(p, '%20', ' ', 'g')
  let p = substitute(p, '%25', '%', 'g')
  if p =~# '^/[A-Za-z]:/'
    let p = p[1:]
  endif
  return has('win32') ? substitute(p, '/', '\\', 'g') : p
endfunction

function! s:BufnrForUri(uri) abort
  return bufnr(s:PathFromUri(a:uri))
endfunction

function! s:DidOpen(bufnr) abort
  if !has_key(s:attached, a:bufnr) || !bufexists(a:bufnr)
    return
  endif
  let info = s:attached[a:bufnr]
  call s:SendNotification('textDocument/didOpen', {
    \ 'textDocument': {
    \   'uri': info.uri,
    \   'languageId': 'plaintext',
    \   'version': info.version,
    \   'text': join(getbufline(a:bufnr, 1, '$'), "\n"),
    \ },
    \ })
endfunction

function! s:DidChange(bufnr) abort
  let s:change_timer = -1
  if !has_key(s:attached, a:bufnr) || !bufexists(a:bufnr)
    return
  endif
  let info = s:attached[a:bufnr]
  let info.version += 1
  call s:SendNotification('textDocument/didChange', {
    \ 'textDocument': {'uri': info.uri, 'version': info.version},
    \ 'contentChanges': [{'text': join(getbufline(a:bufnr, 1, '$'), "\n")}],
    \ })
endfunction

function! package_license_viewer#Attach() abort
  if !g:package_license_viewer_enabled
    return
  endif
  let bufnr = bufnr('%')
  if has_key(s:attached, bufnr)
    return
  endif
  call s:EnsureServer()
  let s:attached[bufnr] = {'uri': s:UriFromPath(expand('%:p')), 'version': 1}
  call s:AfterInit({-> s:DidOpen(bufnr)})
endfunction

function! package_license_viewer#Detach(bufnr) abort
  if has_key(s:attached, a:bufnr)
    call remove(s:attached, a:bufnr)
  endif
endfunction

function! package_license_viewer#OnChange() abort
  if !g:package_license_viewer_enabled
    return
  endif
  let bufnr = bufnr('%')
  if !has_key(s:attached, bufnr)
    return
  endif
  if s:change_timer != -1
    call timer_stop(s:change_timer)
  endif
  let s:change_timer = timer_start(300, {-> s:DidChange(bufnr)})
endfunction

" Re-sends g:package_license_viewer_settings too, so editing it and running :PackageLicenseViewerRefresh is how a setting change actually takes effect — there is no file-watching for it.
function! package_license_viewer#Refresh() abort
  call s:AfterInit({-> s:SendNotification('workspace/didChangeConfiguration', {'settings': g:package_license_viewer_settings})})
  for key in keys(s:attached)
    call s:DidChange(str2nr(key))
  endfor
endfunction

function! package_license_viewer#ClearCache() abort
  if s:job isnot v:null
    call job_stop(s:job)
    " job_stop() is async and job_status() may still report 'run' right after
    " it returns, so clear this synchronously instead of waiting for s:OnExit —
    " otherwise s:EnsureServer() below would see the dying job as still running
    " and skip starting a fresh one, leaving every already-attached buffer
    " (which Attach() no longer re-initializes) stuck with no server.
    let s:job = v:null
    let s:channel = v:null
    let s:server_initialized = 0
  endif
  call s:EnsureServer()
  for key in keys(s:attached)
    let bufnr = str2nr(key)
    call s:AfterInit({-> s:DidOpen(bufnr)})
  endfor
endfunction

function! package_license_viewer#Toggle() abort
  let g:package_license_viewer_enabled = !g:package_license_viewer_enabled
  if !g:package_license_viewer_enabled
    call s:EnsurePropTypes()
    for bufnr in keys(s:attached)
      for type in ['plv_before', 'plv_license', 'plv_after']
        call prop_remove({'type': type, 'bufnr': str2nr(bufnr), 'all': 1})
      endfor
    endfor
  else
    call package_license_viewer#Attach()
    call package_license_viewer#Refresh()
  endif
endfunction

function! package_license_viewer#Shutdown() abort
  if s:job isnot v:null
    call job_stop(s:job)
  endif
endfunction

" ---- rendering -----------------------------------------------------------

function! s:ApplyAnnotations(params) abort
  let bufnr = s:BufnrForUri(a:params.uri)
  if bufnr == -1 || !bufexists(bufnr)
    return
  endif
  call s:EnsurePropTypes()
  for type in ['plv_before', 'plv_license', 'plv_after']
    call prop_remove({'type': type, 'bufnr': bufnr, 'all': 1})
  endfor
  let total_lines = len(getbufline(bufnr, 1, '$'))
  for entry in a:params.entries
    let segs = get(entry, 'segments', v:null)
    if segs is v:null
      continue
    endif
    let lnum = entry.line + 1
    if lnum < 1 || lnum > total_lines
      continue
    endif
    if !empty(segs.before)
      call prop_add(lnum, 0, {'bufnr': bufnr, 'type': 'plv_before', 'text': '  ' . segs.before})
    endif
    if !empty(segs.license)
      let pad = empty(segs.before) ? '  ' : ''
      call prop_add(lnum, 0, {'bufnr': bufnr, 'type': 'plv_license', 'text': pad . segs.license})
    endif
    if !empty(segs.after)
      call prop_add(lnum, 0, {'bufnr': bufnr, 'type': 'plv_after', 'text': segs.after})
    endif
  endfor
endfunction

" ---- hover -----------------------------------------------------------------

function! package_license_viewer#Hover() abort
  if !g:package_license_viewer_enabled
    return
  endif
  let bufnr = bufnr('%')
  if !has_key(s:attached, bufnr) || !s:server_initialized
    return
  endif
  let info = s:attached[bufnr]
  call s:SendRequest('textDocument/hover', {
    \ 'textDocument': {'uri': info.uri},
    \ 'position': {'line': line('.') - 1, 'character': col('.') - 1},
    \ }, function('s:OnHoverResponse'))
endfunction

function! s:OnHoverResponse(response) abort
  let result = get(a:response, 'result', v:null)
  if type(result) != v:t_dict
    return
  endif
  let contents = get(result, 'contents', '')
  let value = type(contents) == v:t_dict ? get(contents, 'value', '') : contents
  if empty(value)
    return
  endif
  call popup_atcursor(split(value, "\n"), {'padding': [0, 1, 0, 1], 'border': []})
endfunction
