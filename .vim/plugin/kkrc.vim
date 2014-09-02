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
" Also I can't believe CentOS software is so ANCIENT
if v:version >= 703
	set cryptmethod=blowfish
endif

" Allow filetype plugin loading
filetype plugin indent on

" p and P should split vertically, since we're all widescreen now
let g:netrw_preview=1

" Move into netrw effortlessly
map - :Rexplore<cr>
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

" Toggle "list" display
map <leader>l :setlocal list!<cr>
" Turn off list display
map <leader>L :setlocal nolist<cr>

" switch to N char tabs (useful when browsing inelegant code)
map <leader>2 :setlocal sw=2 ts=2<cr>
map <leader>4 :setlocal sw=4 ts=4<cr>
map <leader>8 :setlocal sw=8 ts=8<cr>

" Insert a line with the date (used in project notes)
map <leader>dt O# <C-R>=strftime("%Y-%m-%d")<cr><esc><cr>

" Jump direct to tabs 1-9 (and last)
map g1 :tabfirst<cr>
map g2 :tabfirst\|tabnext 2<cr>
map g3 :tabfirst\|tabnext 3<cr>
map g4 :tabfirst\|tabnext 4<cr>
map g5 :tabfirst\|tabnext 5<cr>
map g6 :tabfirst\|tabnext 6<cr>
map g7 :tabfirst\|tabnext 7<cr>
map g8 :tabfirst\|tabnext 8<cr>
map g9 :tabfirst\|tabnext 9<cr>
map g0 :tablast<cr>

" GUI, colors, other extras
colorscheme desert
syn on
if has("gui_running")
    colorscheme kk-rdark
    set guioptions=egmrt
endif

" No automatic folding for .md files
let g:vim_markdown_folding_disabled=1

