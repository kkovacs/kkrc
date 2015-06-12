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
" Cursor position is in the statusline
set noruler
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

" Turn on "list" display
map <leader>l :setlocal list<cr>
" Turn off list display
map <leader>L :setlocal nolist<cr>

" Turn on paste
map <leader>p :setlocal paste<cr>
" Turn off paste
map <leader>P :setlocal nopaste<cr>

" Turn on free cursor movement
map <leader>v :setlocal virtualedit=all<cr>
" Turn off free cursor movement
map <leader>V :setlocal virtualedit=block<cr>

" Force filetype to markdown
map <leader>m :set filetype=mkd<cr>
" Re-run filetype autodetection (not reliable...)
map <leader>M :doautocmd FileType<cr>

" switch to N char tabs (useful when browsing inelegant code)
map <leader>2 :setlocal sw=2 ts=2<cr>
map <leader>4 :setlocal sw=4 ts=4<cr>
map <leader>8 :setlocal sw=8 ts=8<cr>

" Insert a line with the date (used in project notes)
map <leader>dt O# <C-R>=strftime("%Y-%m-%d")<cr><esc><cr>

" Jump direct to tabs 1-7 (and last 3)
" From the beginning...
map g1 :tabfirst<cr>
map g2 :tabfirst\|tabnext 2<cr>
map g3 :tabfirst\|tabnext 3<cr>
map g4 :tabfirst\|tabnext 4<cr>
map g5 :tabfirst\|tabnext 5<cr>
map g6 :tabfirst\|tabnext 6<cr>
map g7 :tabfirst\|tabnext 7<cr>
" ...and from the end
map g8 :tablast\|tabprevious 2<cr>
map g9 :tablast\|tabprevious 1<cr>
map g0 :tablast<cr>

" Highlight the word under the color with 4 different colors.
map <leader>h1 :call matchadd("Highlight1", expand("<cword>"))<cr>
map <leader>h2 :call matchadd("Highlight2", expand("<cword>"))<cr>
map <leader>h3 :call matchadd("Highlight3", expand("<cword>"))<cr>
map <leader>h4 :call matchadd("Highlight4", expand("<cword>"))<cr>
map <leader>h5 :call matchadd("Highlight5", expand("<cword>"))<cr>
map <leader>h6 :call matchadd("Highlight6", expand("<cword>"))<cr>
map <leader>h7 :call matchadd("Highlight7", expand("<cword>"))<cr>
map <leader>h8 :call matchadd("Highlight8", expand("<cword>"))<cr>
map <leader>h9 :call matchadd("Highlight9", expand("<cword>"))<cr>
" Clear all highlights
map <leader>h0 :call clearmatches()<cr>

" GUI, colors, other extras
 " Needed for Base16
let base16colorspace=256
set background=dark
colorscheme kk-base16-colors
syn on
if has("gui_running")
    "colorscheme kk-rdark
    set guioptions=egmrt
endif

" Statusline with a few useful items, but still lightweight (no plugins!)
set statusline=%n%m%h%r\ %f\ [%{strlen(&fenc)?&fenc:'none'},%{&ff}]\ %{&list?'LIST\ ':''}%{&paste?'PASTE\ ':''}%{&virtualedit=='all'?'VIRTUALEDIT\ ':''}%y%=C:%c%V\ L:%l/%L\ %p%%

" A win against the old frenemy, DoMatchParen
" highlight MatchParen cterm=underline,bold ctermbg=none ctermfg=red gui=underline,bold guibg=NONE guifg=red

" Disable starting a comment after Enter
autocmd FileType * setlocal formatoptions-=c formatoptions-=r formatoptions-=o

" No automatic folding for .md files
let g:vim_markdown_folding_disabled=1

