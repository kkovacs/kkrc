" age.vim - Automatically encrypt and decrypt "*.age" files with "age".
" Maintainer: Kristof Kovacs <kkovacs@kkovacs.eu>
" URL: https://github.com/kkovacs/kkrc/blob/master/.vim/plugin/age.vim
" License: MIT
" Reference: https://age-encryption.org
"
" Remote files are supported via netrw (e.g. vim scp://host//path/foo.age):
" netrw transfers the file over the network, while the age encryption/
" decryption itself always runs LOCALLY on the buffer contents. Note that
" like local files, remote .age files are expected to be ASCII-armored
" (the default; a custom g:age_enc_params without -a won't be detected
" when re-reading an already decrypted remote buffer).
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
" NOTE: viminfo we never restore, to prevent copy-buffers leak into it.
function! s:AgeSaveOpts()
    let b:age_saved_opts = {
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

    " NETRW (remote files, e.g. scp://host//path/foo.age): netrw transfers
    " the file into a local temp file and loads it into the buffer itself,
    " then fires BufReadPost/FileReadPost with the URL as <afile>. Since
    " "age" cannot read URLs, decrypt from STDIN instead - the (armored)
    " content is already in the buffer, and "age" still runs locally.
    if l:fname =~ '^[a-z]\+://'
        " If the buffer is not age-armored, it has been decrypted by an
        " earlier event already (netrw's file:// handling fires these
        " events twice); don't touch it.
        if getline(1) !~# '^\(-\{5}BEGIN AGE ENCRYPTED FILE-\{5}\|age-encryption\.org/v1\)'
            setlocal nobin
            call s:AgeRestoreOpts()
            return
        endif
        let l:expr = "%!age " . g:age_dec_params
    else
        let l:expr = "%!age " . g:age_dec_params . " " . shellescape(l:fname, 1)
    endif

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
    " Success requires the ciphertext header, not just a zero exit code:
    " a misconfigured age (or wrapper) that exits 0 without encrypting
    " would otherwise let PLAINTEXT reach netrw's local temp file and the
    " remote host. (age's binary format also starts with the ASCII string
    " "age-encryption.org/v1", so this covers non-armored output too.)
    let l:success = ! v:shell_error && getline(1) =~# '^\(-\{5}BEGIN AGE ENCRYPTED FILE-\{5}\|age-encryption\.org/v1\)'

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
    " netrw's BufWriteCmd marks the buffer unmodified BEFORE this event; a
    " plain :w does it via Vim itself. Remember it, because the undo below
    " re-modifies the buffer, and we want to preserve the saved-state flag.
    let l:was_nomod = ! &l:modified
    " Undo the encryption so the buffer holds plaintext again.
    silent! undo
    setlocal nobin
    call s:AgeRestoreOpts()
    if l:was_nomod
        setlocal nomod
    endif
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
" NOTE: at BufNew the new buffer is NOT current, so :setlocal would hit the wrong buffer — setbufvar() targets <abuf> explicitly.
autocmd BufNew *.age set viminfo= | call setbufvar(str2nr(expand('<abuf>')), '&swapfile', 0) | call setbufvar(str2nr(expand('<abuf>')), '&undofile', 0)

" End of age_encrypted
augroup END

" vim: set sw=4 et :
