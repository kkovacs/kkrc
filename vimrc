
" KKRC START - do not modify code between the KKRC markers, it may be overwritten automatically!

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
set cindent
" In block mode I like to move beyond line endings
set virtualedit=block
" Anyone who doesn't use UTF-8 in the 21st century should be glued to an old IBM 3270 terminal and thrown into the Danube
set encoding=utf8

" *** Mappings ***

" I like to scroll the screen and advance the cursor at the same time
map <c-j> j<c-e>
map <c-k> k<c-y>

" Tab navigation - I love tabs and I need to move easily between them
"map <c-l> :tabnext<enter>
"map <c-h> :tabprevious<enter>

" I rarely edit only one big file nowadays, so I like to move to netrw easily
map - :Explore<cr>

" GUI, colors, other extras
" colorscheme delek
" set guifont=Courier:h12
" set guifont=Monaco:h10
syn on

" *** OS X specific ***

" Safari-like tab navigation
"map <S-D-Right> :tabnext<cr>
"map <S-D-Left> :tabprevious<cr>

" Hotkey to my notepad. I don't just open a file but run a script, so I can add some features
"map gn :so ~/.notes/notes.vim<cr>
"autocmd BufRead,BufNewFile notes.txt setf notes

" Taglist (needs VIM plugin from http://vim-taglist.sourceforge.net/ )
"map K :Tlist<cr>

" git grep
"set grepprg=git\ grep\ -n\ \$\*

" KKRC END
