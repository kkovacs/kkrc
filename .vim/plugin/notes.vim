
" .notes files are for my notetaking. They should look like a list of cards.

:autocmd BufEnter *.notes set foldmethod=expr | set foldexpr=(getline(v:lnum)[0]==\"[\")?\">1<1\":\"1\" | set ignorecase incsearch nohls

" Also for encrypted files
:autocmd BufEnter *.notes.gpg set foldmethod=expr | set foldexpr=(getline(v:lnum)[0]==\"[\")?\">1<1\":\"1\" | set ignorecase incsearch nohls

