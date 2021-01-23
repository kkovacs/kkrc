
" Using Pathogen to handle plugins, but the way that pathogen itself is a bundle
"runtime bundle/vim-pathogen/autoload/pathogen.vim
"execute pathogen#infect()

" Main stuff now lives in .vim/plugin/kkrc.vim
" Example local hotkeys:

"map KK :set nobackup noswapfile<cr>:cd ~/Notes<cr>:vi .<cr>/^todo<cr>
"autocmd BufRead,BufNewFile *.kk.txt setf notes
