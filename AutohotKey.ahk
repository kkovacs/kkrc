;
; OSX-like (Mac-like) AutoHotKey script, based on the work of Veil <veilure@gmail.com> by KKovacs
; Platform: Win9x/NT/XP/Vista
;

#NoEnv  ; Recommended for performance and compatibility with future AutoHotkey releases.
SendMode Input  ; Recommended for new scripts due to its superior speed and reliability.
SetWorkingDir %A_ScriptDir%  ; Ensures a consistent starting directory.

;
; ### PART I: Mac-like flying accents (diacritics) ###
;
#UseHook
;#VKC0SC029::Return	; grave -> the grave ` accent gave some probs, used the virtualkey + scancode instead
#e::Return		; acute
#i::Return		; circumflex
#t::Return		; tilde
#u::Return		; umlaut
#j::Return		; doubleacute

;                  1 2 3 4 5 6 7 8 9 1 1 2
;                                    0 1 2
;              r   g G a A c C t T u U d D
a::diacritic("a","a,A,á,Á,â,Â,a,A,ä,Ä,a,A")
e::diacritic("e","e,E,é,É,e,E,e,E,ë,Ë,e,E")
i::diacritic("i","i,I,í,Í,î,Î,i,I,i,I,i,I")
o::diacritic("o","o,O,ó,Ó,ô,Ô,o,O,ö,Ö,õ,Õ")
u::diacritic("u","u,U,ú,Ú,u,U,u,U,ü,Ü,û,Û")
; Now again, with SHIFT. ("*" didn't work correctly, it swallows CTRL-A, for example)
+a::diacritic("a","a,A,á,Á,â,Â,a,A,ä,Ä,a,A")
+e::diacritic("e","e,E,é,É,e,E,e,E,ë,Ë,e,E")
+i::diacritic("i","i,I,í,Í,î,Î,i,I,i,I,i,I")
+o::diacritic("o","o,O,ó,Ó,ô,Ô,o,O,ö,Ö,õ,Õ")
+u::diacritic("u","u,U,ú,Ú,u,U,u,U,ü,Ü,û,Û")

diacritic(regular,accentedCharacters) {
	StringSplit, char, accentedCharacters, `,
	graveOption            := char1
	graveShiftOption       := char2
	acuteOption            := char3
	acuteShiftOption       := char4
	circumflexOption       := char5
	circumflexShiftOption  := char6
	tildeOption            := char7
	tildeShiftOption       := char8
	umlautOption           := char9
	umlautShiftOption      := char10
	doubleacuteOption      := char11
	doubleacuteShiftOption := char12
	
	if (A_PriorHotKey = "#VKC0SC029" && A_TimeSincePriorHotkey < 2000) {
		if (GetKeyState("Shift")) {
			SendInput % graveShiftOption
		} else {
			SendInput % graveOption
		}
	} else if (A_PriorHotKey = "#j" && A_TimeSincePriorHotkey < 2000) {
		if (GetKeyState("Shift")) {
			SendInput % doubleacuteShiftOption
		} else {
			SendInput % doubleacuteOption
		}
	} else if (A_PriorHotKey = "#e" && A_TimeSincePriorHotkey < 2000) {
		if (GetKeyState("Shift")) {
			SendInput % acuteShiftOption
		} else {
			SendInput % acuteOption
		}
	} else if (A_PriorHotKey = "#i" && A_TimeSincePriorHotkey < 2000) {
		if (GetKeyState("Shift")) {
			SendInput % circumflexShiftOption
		} else {
			SendInput % circumflexOption
		}		
	} else if (A_PriorHotKey = "#t" && A_TimeSincePriorHotkey < 2000) {
		if (GetKeyState("Shift")) {
			SendInput % tildeShiftOption
		} else {
			SendInput % tildeOption
		}
	} else if (A_PriorHotKey = "#u" && A_TimeSincePriorHotkey < 2000) {
		if (GetKeyState("Shift")) {
			SendInput % umlautShiftOption
		} else {
			SendInput % umlautOption
		}
	} else {
		if (GetKeyState("Shift")) {
			SendInput % "+" regular
		} else {
			SendInput % regular
		}
	}
}

;
; ### PART II: Other special Characters ###
;
#*1::altShift("!","/")
#*2::altShift("™","€")
#*3::altShift("L","‹")
#*4::altShift("c","›")
#*5::altShift("§","%")
#*6::altShift("^","^")
#*7::altShift("¶","‡")
#*8::altShift("•","°")
#*9::altShift("a","·")
#*0::altShift("o","‚")

#*d::altShift("?","?")
#*f::altShift("f","F")
#*g::altShift("©","G")
#*o::altShift("o","O")
#*q::altShift("o","O")
#*r::altShift("®","‰")
#*s::altShift("ß","S")
#*t::altShift("?","?")
#*y::altShift("Y","Y")

#*-::altShift("–","—")
#*+::altShift("?","±")
#*[::altShift("“","”")
#*]::altShift("‘","’")
#*`;::altShift("…","?")
#*'::altShift("a","A")
#*\::altShift("«","»")
#*,::altShift("?","„")
#*.::altShift("?",">")
#*/::altShift("÷","?")

altShift(accented,accentedShift) {
	if (!GetKeyState("Shift")) {
		SendInput % accented
	} else {
		SendInput % accentedShift
	}
}

;
; ### PART III: Messing with Modifier Keys
;
; Make CAPS LOCK act as CONTROL
Capslock::Ctrl

;; disable Win key behavior of popping up the Start Menu, but don't disable Win+‹key› combination
;~LWin Up::Return
;~RWin Up::Return

; "í" key to Shift (XXX: but aeiou works only once with it)
SC056::LShift
