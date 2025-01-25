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

function! s:AgeReadPre()
    setl secure
    setl cmdheight=3
    setl viminfo=
    setl clipboard=
    setl noswapfile
    setl nobackup
    setl noundofile
    setl noshelltemp
    setl shell=/bin/sh
    setl bin
    setl shellredir=>
endfunction

function! s:AgeReadPost()
    let l:expr = "%!age " . g:age_dec_params . " " . expand("%")

    setl undolevels=-1
    silent! execute l:expr
    let l:success = ! v:shell_error

    if ! l:success
        " Cleanup.
        setl nobin
        setl shellredir&
        setl shell&
        setl cmdheight&
        redraw!
        throw "Decryption error!"
    endif

    " Cleanup.
    setl nobin
    setl cmdheight&
    setl shellredir&
    setl shell&
    execute ":doautocmd BufReadPost ".expand("%:r")
    setl undolevels&
    redraw!
endfunction

function! s:AgeWritePre()
    setl cmdheight=3
    setl shell=/bin/sh
    setl bin
    setl shellredir=>
    let l:expr = "%!age " . g:age_enc_params
    silent! execute l:expr
    let l:success = ! v:shell_error

    if ! l:success
        " Cleanup
        silent! undo
        setl nobin
        setl shellredir&
        setl shell&
        setl cmdheight&
        redraw!
        " Display error
        throw "Encryption error!"
    endif
endfunction

function! s:AgeWritePost()
    " Undo the encryption.
    silent! undo
    setl nobin
    setl shellredir&
    setl shell&
    setl cmdheight&
    redraw!
endfunction

autocmd BufReadPre,FileReadPre     *.age call s:AgeReadPre()
autocmd BufReadPost,FileReadPost   *.age call s:AgeReadPost()
autocmd BufWritePre,FileWritePre   *.age call s:AgeWritePre()
autocmd BufWritePost,FileWritePost *.age call s:AgeWritePost()

" End of age_encrypted
augroup END

" vim: set sw=4 et :
