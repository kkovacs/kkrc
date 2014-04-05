" KKovacs's .vimrc file

" I hated backup files ever since Turbo Pascal started making them
set nobackup
" If I wanted things to be the legacy VI way, I wouldn't be using VIM
set nocompatible
" I like to look ahead when I search
set incsearch
" I like to see what I found
set hlsearch
" I like to see the pair of any braces
set showmatch
" I usually edit C-like code (C, PHP, JAVA, etc)
set autoindent
" In block mode I like to move beyond line endings
set virtualedit=block
" Anyone who doesn't use UTF-8 in the 21th century should be shot
set encoding=utf8
" Turn on wildmenu in Ex mode
set wildmenu
set wildmode=list:longest
" Always have a status line
set laststatus=2
" Always show me the cursor position
set ruler
" No cursor line
set nocursorline
" So the stronger encryption never gets frogotten
set cryptmethod=blowfish

" Allow filetype plugin loading
filetype plugin indent on

" p and P should split vertically, since we're all widescreen now
let g:netrw_preview=1

" Move into netrw effortlessly
map - :Explore<cr>
" Like the previous, but in a new tab
map _ :Texplore<cr>

" I like to scroll the screen and advance the cursor at the same time
map <c-j> j<c-e>
map <c-k> k<c-y>

" GUI tab navigation
map <c-tab> :tabnext<cr>
map <s-c-tab> :tabprevious<cr>

" My little calculator
map <leader>c viW"zyA = <esc>"=<c-r>z<cr>p

" GUI, colors, other extras
colorscheme desert
syn on
if has("gui_running")
    colorscheme kk-rdark
    set guioptions=egmrt
endif

" No automatic folding for .md files
let g:vim_markdown_folding_disabled=1

" Default list style is tree
let g:netrw_liststyle=4

