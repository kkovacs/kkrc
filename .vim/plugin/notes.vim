
" .notes files are for my notetaking. They should look like a list of cards.
:autocmd BufEnter *.notes setlocal foldmethod=expr | setlocal foldexpr=(getline(v:lnum)[0]==\"[\")?\">1<1\":\"1\" | setlocal ignorecase incsearch nohls

" Also for encrypted files
:autocmd BufEnter *.notes.gpg setlocal foldmethod=expr | setlocal foldexpr=(getline(v:lnum)[0]==\"[\")?\">1<1\":\"1\" | setlocal ignorecase incsearch nohls
