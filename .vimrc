" KKovacs's .vimrc file

" ** Options ***

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

" *** netrw ***
" p and P should split vertically, since I'm widescreen
let g:netrw_preview=1

" *** Mappings ***

" I like to scroll the screen and advance the cursor at the same time
map <c-j> j<c-e>
map <c-k> k<c-y>

" Move into netrw effortlessly
map - :Explore<cr>
" Like the previous, but in a new tab
map _ :Texplore<cr>

" GUI, colors, other extras
syn on

" Error (grep) navgation
map <C-Right> :tabNext<enter>
map <C-Left> :tabPrev<enter>

" GUI tab navigation
map <S-D-Right> :tabnext<cr>
map <S-D-Left> :tabprevious<cr>
map <M-D-Right> :tabnext<cr>
map <M-D-Left> :tabprevious<cr>

" Linux terminal-like clipboard handling
map <c-s-c> "+y
map <c-s-v> "+p
imap <c-s-v> <c-r>+

" A window just the right size
" :set lines=53
" :set columns=170

" Allow filetype plugin loading
:filetype plugin indent on

" My little calculator
map gc viW"zyA = <esc>"=<c-r>z<cr>p

set relativenumber
set ruler
colorscheme desert

if has("gui_running")
    colorscheme kk-rdark
    set guioptions=egmrt
endif

set nocursorline

let g:vim_markdown_folding_disabled=1

" My full screen
:map gF :set columns=999 guioptions=-R lines=999 fullscreen<cr>:colorscheme torte<cr>

" Local commands:
