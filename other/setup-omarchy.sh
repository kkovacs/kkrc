#!/bin/bash
#
# This script configures my Omarchy.
# Unfortunately Omarchy and me are both opinionated. This leads to inelegant solutions.
#

# Safety
set -e

printf "\nSetting up Omarchy...\n\n"

# Load helper functions to edit files Ansible-style
. ~/.kkrc/inject-func-lineinfile.txt

# Edit hypr monitors
# XXX this might be MacBook Air specific
_lineinfile 'omarchy_gdk_scale' 'local omarchy_gdk_scale = "1"' ~/.config/hypr/monitors.lua

# Edit hypr keybinds
_blockinfile "-- START kkrc" "-- END kkrc" ~/.config/hypr/bindings.lua <<"EOF"
-- START kkrc
-- Prevent SUPER+W as window close
hl.unbind("SUPER + W")
-- Install our own window close
o.bind("SUPER + Q", "Close window", hl.dsp.window.close())

-- Function keys switch to workspaces
hl.bind("F1", hl.dsp.focus({workspace="1"}))
hl.bind("F2", hl.dsp.focus({workspace="2"}))
hl.bind("F3", hl.dsp.focus({workspace="3"}))
hl.bind("F4", hl.dsp.focus({workspace="4"}))
hl.bind("F5", hl.dsp.focus({workspace="5"}))
hl.bind("F6", hl.dsp.focus({workspace="6"}))
hl.bind("F7", hl.dsp.focus({workspace="7"}))
hl.bind("F8", hl.dsp.focus({workspace="8"}))
hl.bind("F9", hl.dsp.focus({workspace="9"}))
hl.bind("F10", hl.dsp.focus({workspace="10"}))
-- END kkrc
EOF

# Edit hypr inputs
_blockinfile "-- START kkrc" "-- END kkrc" ~/.config/hypr/input.lua <<"EOF"
-- START kkrc
hl.config({
  input = {
    kb_options = "ctrl:nocaps,compose:ralt",
    touchpad = {
      natural_scroll = true,
    },
  },
})
hl.gesture({ fingers = 3, direction = "horizontal", action = "workspace" })
-- END kkrc
EOF

# Edit hypr inputs
_blockinfile "# START kkrc" "# END kkrc" ~/.config/ghostty/config <<"EOF"
# START kkrc
font-feature = -calt
keybind = ctrl+tab=esc:[27;5;9~
keybind = ctrl+shift+tab=esc:[27;6;9~
keybind = ctrl+backspace=esc:[127;5u
theme = Synthwave
#theme = Dark Modern
#theme = Later This Evening
#theme = Midnight In Mojave
#theme = Operator Mono Dark
#theme = Vercel
# END kkrc
EOF

# Exit with success
exit 0
