
" .notes files are for my notetaking. They should look like a list of cards.
:autocmd BufEnter *.notes setlocal foldmethod=expr | setlocal foldexpr=(getline(v:lnum)[0]==\"[\")?\">1<1\":\"1\" | setlocal ignorecase incsearch nohls

" Also for encrypted files
:autocmd BufEnter *.notes.gpg setlocal foldmethod=expr | setlocal foldexpr=(getline(v:lnum)[0]==\"[\")?\">1<1\":\"1\" | setlocal ignorecase incsearch nohls

" Notebook mode - send commands via tmux
" Send current line
nmap <silent> S :.w !sed 's/^[[:space:]]*//' >/tmp/scratch<cr>:echo system("tmux load-buffer -b scratch /tmp/scratch; tmux paste-buffer -d -b scratch")<cr>
" Send visual selection (line-wise)
vmap <silent> S :'<,'>w !sed 's/^[[:space:]]*//' >/tmp/scratch<cr>:echo system("tmux load-buffer -b scratch /tmp/scratch; tmux paste-buffer -d -b scratch")<cr>
