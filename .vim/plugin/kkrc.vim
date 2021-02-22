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
" Mode lines are the best
set modeline
" Show normal-mode commands as typed
set showcmd
" No cursor line
set nocursorline
" No viminfo
set viminfo=
" Don't ruin my carefully opened/closed folds when searching. I can use <space> (defined later) to peek.
set foldopen=hor,insert,undo
" So the stronger encryption never gets frogotten
" Also I can't believe CentOS software is so ANCIENT
if v:version >= 704
	set cryptmethod=blowfish
endif
if v:version >= 730
	set cryptmethod=blowfish2
endif

" Allow filetype plugin loading
filetype plugin indent on

" p and P should split vertically, since we're all widescreen now
let g:netrw_preview=1

" Move into netrw effortlessly
map <silent> - :Rexplore<cr>
" Like the previous, but in a new tab
map <silent> _ :Texplore<cr>

" I like to scroll the screen and advance the cursor at the same time
map <c-j> j<c-e>
map <c-k> k<c-y>

" GUI tab navigation
map <silent> <c-tab> :tabnext<cr>
map <silent> <s-c-tab> :tabprevious<cr>

" My little calculator
map <leader>= viW"zyA = <esc>"=<c-r>z<cr>p

" cd into current file's diectory for this buffer only (!)
map <leader>c :lchdir <c-r>=expand('%:p:h')<cr><cr>
" cd into current file's diectory globally
map <leader>C :chdir <c-r>=expand('%:p:h')<cr><cr>

" Turn on "list" display
map <silent> <leader>l :setlocal list<cr>
" Turn off list display
map <silent> <leader>L :setlocal nolist<cr>

" Turn on paste
map <silent> <leader>p :setlocal paste<cr>
" Turn off paste
map <silent> <leader>P :setlocal nopaste<cr>

" Turn on free cursor movement
map <silent> <leader>v :setlocal virtualedit=all<cr>
" Turn off free cursor movement
map <silent> <leader>V :setlocal virtualedit=block<cr>

" Turn on expandtab
map <silent> <leader>e :setlocal expandtab<cr>
" Turn off expandtab
map <silent> <leader>E :setlocal noexpandtab<cr>

" Turn on nowrap
map <silent> <leader>w :setlocal nowrap<cr>
" Turn off expandtab
map <silent> <leader>W :setlocal wrap<cr>

" Force filetype to markdown
map <silent> <leader>d :set filetype=markdown<cr>
" Re-run filetype autodetection (not reliable...)
map <silent> <leader>D :doautocmd FileType<cr>

" Turn on mouse
map <silent> <leader>m :set mouse=a<cr>
" Turn off mouse
map <silent> <leader>M :set mouse=<cr>

" Turn on relativenumber
map <silent> <leader>r :set relativenumber<cr>
" Turn off relativenumber
map <silent> <leader>R :set norelativenumber<cr>

" Turn on scrollbind
map <silent> <leader>s :set scrollbind<cr>
" Turn off scrollbind
map <silent> <leader>S :set noscrollbind<cr>

" NOTE: My "text" mode was renamed to "plaintext" so the "\t..." keys are free for TableMode
" Turn on my plain-text mode
map <silent> <leader>p :setlocal nu linebreak breakindent wrap<cr>:noremap <buffer> <silent>j gj<cr>:noremap <buffer> <silent> k gk<cr>
" Turn off my text mode
map <silent> <leader>P :setlocal nonu nolinebreak nobreakindent<cr>:unmap <buffer> j<cr>:unmap <buffer> k<cr>

" switch to N char tabs (useful when browsing inelegant code)
map <leader>2 :setlocal sw=2 ts=2<cr>
map <leader>4 :setlocal sw=4 ts=4<cr>
map <leader>8 :setlocal sw=8 ts=8<cr>

" Insert a line with the date (used in project notes)
map <leader>dt O# <C-R>=strftime("%Y-%m-%d")<cr><esc><cr>

" Better next/prev tab
map <silent> <c-n> :tabnext<cr>
map <silent> <c-p> :tabprevious<cr>
map <silent> <leader>, :tabmove -1<cr>
map <silent> <leader>. :tabmove +1<cr>
map <leader>x :close<cr>

if has("gui_macvim")
	map <d-1> 1gt
	map <d-2> 2gt
	map <d-3> 3gt
	map <d-4> 4gt
	map <d-5> 5gt
	map <d-6> 6gt
	map <d-7> 7gt
	map <d-8> 8gt
	map <d-9> 9gt
	map <silent> <d-0> :tablast<cr>
endif

" Highlight the word under the color with 4 different colors.
map <silent> <leader>h1 :call matchadd("Highlight1", expand("<cword>"))<cr>
map <silent> <leader>h2 :call matchadd("Highlight2", expand("<cword>"))<cr>
map <silent> <leader>h3 :call matchadd("Highlight3", expand("<cword>"))<cr>
map <silent> <leader>h4 :call matchadd("Highlight4", expand("<cword>"))<cr>
map <silent> <leader>h5 :call matchadd("Highlight5", expand("<cword>"))<cr>
map <silent> <leader>h6 :call matchadd("Highlight6", expand("<cword>"))<cr>
map <silent> <leader>h7 :call matchadd("Highlight7", expand("<cword>"))<cr>
map <silent> <leader>h8 :call matchadd("Highlight8", expand("<cword>"))<cr>
map <silent> <leader>h9 :call matchadd("Highlight9", expand("<cword>"))<cr>
" Clear all highlights
map <silent> <leader>h0 :call clearmatches()<cr>

" Clear all highlights
nmap <silent> <leader>/ :nohlsearch<cr>

" Folding: Map Space to fold toggle
nmap <space> za
" Folding: Outline view: map Enter to close all folds
nmap <cr> zM

" GUI, colors, other extras
 " Needed for Base16
let base16colorspace=256
set background=dark
colorscheme kk-base16-colors
syn on
if has("gui_running")
	"colorscheme kk-rdark
	set guioptions=e

	" OS-specific stuff, like fonts
	if has("gui_macvim")
		set guifont=Monaco:h11
	elseif has("gui_gtk")
	elseif has("gui_win32")
	endif
endif

" Vim 8.1's new terminal mode is really exciting.
" But it needs a better get-back-to-command-mode key, let's use double-ESC
if has('terminal')
	tmap <esc><esc> <c-\><c-N>
	map <leader><leader> :vertical below terminal<cr>
	map <leader>\| :tab terminal<cr>
endif

" Statusline with a few useful items, but still lightweight (no plugins!)
set statusline=%n%m%h%r\ %f\ [%{strlen(&fenc)?&fenc:'none'},%{&ff}]\ %{&list?'LIST\ ':''}%{&linebreak?'TEXTMODE\ ':''}%{&scrollbind?'SCROLLBIND\ ':''}%{&scrollbind?'SCROLLBIND\ ':''}%{&expandtab?'EXPANDTAB\ ':''}%{&wrap?'':'NOWRAP\ '}%{&paste?'PASTE\ ':''}%{&virtualedit=='all'?'VIRTUALEDIT\ ':''}%{strlen(&mouse)?'MOUSE\ ':''}%y%=C:%c%V\ L:%l/%L\ %p%%

" A win against the old frenemy, DoMatchParen
" highlight MatchParen cterm=underline,bold ctermbg=none ctermfg=red gui=underline,bold guibg=NONE guifg=red

" Disable starting a comment after Enter
autocmd FileType * setlocal formatoptions-=c formatoptions-=r formatoptions-=o

" Fix YAML to 2-space
autocmd FileType yaml setlocal ts=2 sts=2 sw=2 expandtab

" Fenced languages for markdown
let g:markdown_fenced_languages = ['yaml', 'json', 'xml', 'python', 'bash', 'sh', 'javascript', 'js=javascript', 'c', 'go', 'golang=go', 'java', 'sql']

" Markdown folding: best of both worlds:
" Let's do folding of .md files...
let g:markdown_folding = 1
" ...but don't just collapse everything on load.
autocmd FileType markdown setlocal foldlevel=99

" Jupyter notebook inspiration - send commands into tmux.
" XXX: "open -a iTerm" is Mac-specific
" Send current line
nmap <silent> S :silent .w !sed 's/^\t//' \| tmux load-buffer -b jupyter - ; open -a iTerm ; tmux paste-buffer -d -b jupyter<cr>
" Send visual selection (line-wise)
" HACK: The Home/End hack is to avoid not being able to pass a range to :silent.
vmap <silent> S :<home>silent <end>w !sed 's/^\t//' \| tmux load-buffer -b jupyter - ; open -a iTerm ; tmux paste-buffer -d -b jupyter<cr>
