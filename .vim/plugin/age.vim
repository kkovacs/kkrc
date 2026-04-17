" age.vim - Automatically encrypt and decrypt "*.age" files with "age".
" Maintainer: Kristof Kovacs <kkovacs@kkovacs.eu>
" URL: https://github.com/kkovacs/kkrc/blob/master/.vim/plugin/age.vim
" License: MIT
" Reference: https://age-encryption.org
"
" If ~/.ssh/age.key exists, it is used as identity, else simple password
" encryption is used.
"
" The recommended way is to use a PASSWORDED KEY (to eliminate the risk of
" accidentally re-encrypting files with a mistyped password).
"
" To generate your own passworded age-key:
"
"     age-keygen | age -p -o ~/.ssh/age.key && chmod 600 ~/.ssh/age.key
"
" For somewhat password-store-like functionality, use a ".md.age" extension,
" so you get VIM folding.
"
" CREDITS: This script is vaguely based on (alphabetic order):
" - openssl.vim by Daniel Perelman and Noah Spurrier (https://github.com/dperelman/openssl.vim)
" - vim-encpipe by Łukasz Jan Niemier (https://github.com/hauleth/vim-encpipe/)
" - vim-gnupg by James McCoy (https://github.com/jamessan/vim-gnupg)

" Prevent double loading of script
augroup age_encrypted
if exists("age_encrypted_loaded")
    finish
endif
let age_encrypted_loaded = 1
autocmd!

" If g:age_enc_params are defined by the user, use that. Put in your ~/.vimrc:
" let g:age_enc_params="..."
" let g:age_dec_params="..."
if !exists("g:age_enc_params")
    " If the key file exists...
    if filereadable(expand("~/.ssh/age.key"))
        " ...use the key file.
        let g:age_enc_params="-e -i ~/.ssh/age.key -a"
        let g:age_dec_params="-d -i ~/.ssh/age.key"
    else
        " If no key file, use symmetric password encryption.
        let g:age_enc_params="-e -p -a"
        let g:age_dec_params="-d"
    endif
endif

" Save the given list of GLOBAL options into b:age_saved_opts so we can
" restore them later. We must use the global options (viminfo, clipboard,
" shelltemp, backup, shell, shellredir are all global) because :setlocal
" on a global option is either a no-op or affects everyone.
function! s:AgeSaveOpts()
    let b:age_saved_opts = {
        \ 'viminfo':    &g:viminfo,
        \ 'clipboard':  &g:clipboard,
        \ 'shelltemp':  &g:shelltemp,
        \ 'backup':     &g:backup,
        \ 'writebackup':&g:writebackup,
        \ 'shell':      &g:shell,
        \ 'shellredir': &g:shellredir,
        \ 'cmdheight':  &g:cmdheight,
        \ }
endfunction

function! s:AgeRestoreOpts()
    if !exists("b:age_saved_opts")
        return
    endif
    let &g:viminfo     = b:age_saved_opts.viminfo
    let &g:clipboard   = b:age_saved_opts.clipboard
    let &g:shelltemp   = b:age_saved_opts.shelltemp
    let &g:backup      = b:age_saved_opts.backup
    let &g:writebackup = b:age_saved_opts.writebackup
    let &g:shell       = b:age_saved_opts.shell
    let &g:shellredir  = b:age_saved_opts.shellredir
    let &g:cmdheight   = b:age_saved_opts.cmdheight
    unlet b:age_saved_opts
endfunction

" Harden the environment so plaintext does not leak into viminfo, swap,
" backup, undo files, the system clipboard, or shell temp files.
function! s:AgeHarden()
    call s:AgeSaveOpts()
    " Global options — must use :set, not :setlocal.
    set viminfo=
    set clipboard=
    set noshelltemp
    set nobackup
    set nowritebackup
    set shell=/bin/sh
    set shellredir=>
    set cmdheight=3
    " Buffer/window-local options.
    setlocal noswapfile
    setlocal noundofile
endfunction

function! s:AgeReadPre()
    call s:AgeHarden()
    setlocal bin
endfunction

function! s:AgeReadPost()
    " <afile> is the file being read (correct for both BufReadPost and
    " FileReadPost); shellescape() prevents command injection via
    " filenames containing shell metacharacters. The '1' argument to
    " shellescape() additionally escapes '!', '%' and '#' which are
    " special to :execute / :!.
    let l:fname = expand("<afile>")
    let l:expr = "%!age " . g:age_dec_params . " " . shellescape(l:fname, 1)

    setlocal undolevels=-1
    silent! execute l:expr
    let l:success = ! v:shell_error

    if ! l:success
        " Wipe any partial/garbage output that age may have produced
        " before failing, so plaintext-ish bytes are not left visible.
        silent! %delete _
        setlocal nobin
        setlocal undolevels&
        call s:AgeRestoreOpts()
        redraw!
        throw "Decryption error!"
    endif

    setlocal nobin
    " fnameescape() prevents a filename with spaces, '|', '"', backticks,
    " etc. from breaking out of the :doautocmd argument into further Ex
    " commands. We pass the root (without the .age extension) so syntax,
    " filetype, folding, etc. are picked up based on the inner extension
    " (e.g. foo.md.age -> foo.md).
    execute "doautocmd BufReadPost " . fnameescape(fnamemodify(l:fname, ":r"))
    setlocal undolevels&
    call s:AgeRestoreOpts()
    redraw!
endfunction

function! s:AgeWritePre()
    " Save current cursor position to jump back to after encryption.
    let b:line_before_save = getcurpos()
    call s:AgeHarden()
    setlocal bin
    let l:expr = "%!age " . g:age_enc_params
    silent! execute l:expr
    let l:success = ! v:shell_error

    if ! l:success
        " Revert the failed filter so the buffer contains plaintext again.
        silent! undo
        setlocal nobin
        call s:AgeRestoreOpts()
        unlet b:line_before_save
        redraw!
        throw "Encryption error!"
    endif
endfunction

function! s:AgeWritePost()
    " Undo the encryption so the buffer holds plaintext again.
    silent! undo
    setlocal nobin
    call s:AgeRestoreOpts()
    " Jump back to saved cursor position.
    if exists("b:line_before_save")
        call setpos('.', b:line_before_save)
        unlet b:line_before_save
    endif
    redraw!
endfunction

autocmd BufReadPre,FileReadPre     *.age call s:AgeReadPre()
autocmd BufReadPost,FileReadPost   *.age call s:AgeReadPost()
autocmd BufWritePre,FileWritePre   *.age call s:AgeWritePre()
autocmd BufWritePost,FileWritePost *.age call s:AgeWritePost()

" End of age_encrypted
augroup END

" vim: set sw=4 et :
