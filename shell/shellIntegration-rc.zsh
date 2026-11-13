autoload -U add-zsh-hook

if [[ -f $USER_ZDOTDIR/.zshrc ]]; then
	ZDOTDIR=$USER_ZDOTDIR
	. $USER_ZDOTDIR/.zshrc
fi

__is_prompt_start() {
	builtin printf '\e]6973;PS\a' > /dev/tty
}

__is_prompt_end() {
	builtin printf '\e]6973;PE\a' > /dev/tty
}

__is_escape_value() {
	builtin emulate -L zsh

	# Process text byte by byte, not by codepoint.
	builtin local LC_ALL=C str="$1" i byte token out=''

	for (( i = 0; i < ${#str}; ++i )); do
		byte="${str:$i:1}"

		# Escape backslashes and semi-colons
		if [ "$byte" = "\\" ]; then
			token="\\\\"
		elif [ "$byte" = ";" ]; then
			token="\\x3b"
		elif [ "$byte" = $'\n' ]; then
			token="\x0a"
		elif [ "$byte" = $'\e' ]; then
			token="\\x1b"
		elif [ "$byte" = $'\a' ]; then
			token="\\x07"
		else
			token="$byte"
		fi

		out+="$token"
	done

	builtin print -r "$out"
}

__is_update_cwd() {
	builtin printf '\e]6973;CWD;%s\a' "$(__is_escape_value "${PWD}")"
}

# Markers inside PS1 are printed every time zsh draws the prompt, including redraws from `zle reset-prompt`
# (oh-my-zsh async git info, themes that refresh the prompt). Without them the prompt end is only recorded
# once at zle-line-init, before the async part appears, and the late text is mistaken for the typed command.
__is_ps1_start=$'%{\e]6973;PS\a%}'
__is_ps1_end=$'%{\e]6973;PE\a%}'

__is_wrap_prompt() {
	[[ $PS1 == *$'\e]6973;PE'* ]] && return
	PS1="${__is_ps1_start}${PS1}${__is_ps1_end}"
}

# the exported variables, so the commands behind the lists (kubectl, aws, git) run with what this shell has, not with
# what terminalhinter saw when it started at the top of .zshrc. Written to terminalhinter's private file when something
# changed, and only a short ENV goes through the terminal.
__is_report_env() {
	[[ -n $ISTERM_ENV_FILE ]] || return
	builtin emulate -L zsh
	builtin local name out=''
	for name in ${(ok)parameters[(R)*export*]}; do
		case $name in _|PWD|OLDPWD|SHLVL) continue ;; esac
		out+="${name}=${(P)name}"$'\x1e'
	done
	[[ $out == "$__is_last_env" ]] && return
	builtin print -rn -- "$out" >| "$ISTERM_ENV_FILE" 2>/dev/null || return
	typeset -g __is_last_env=$out
	builtin printf '\e]6973;ENV\a'
}

__is_precmd() {
	__is_report_env
	__is_update_cwd
	if [[ $ISTERM_TESTING == "1" ]]; then
		PS1="%{$(__is_prompt_start)%}> %{$(__is_prompt_end)%}"
	fi
	__is_wrap_prompt
}

if (( ${+widgets[zle-line-init]} )); then
	zle -A zle-line-init __is_orig_zle_line_init
	__is_zle_line_init() {
		__is_prompt_start
		zle __is_orig_zle_line_init
		__is_prompt_end
	}
else
	__is_zle_line_init() {
		__is_prompt_start
		__is_prompt_end
	}
fi
zle -N zle-line-init __is_zle_line_init

add-zsh-hook precmd __is_precmd

# the exit code of the command that just ran, so a failed one can be offered a fix at the next prompt; it has to be
# the first precmd hook, the ones before it would change $?
__is_report_status() {
	builtin printf '\e]6973;EX;%s\a' "$?"
}
precmd_functions=(__is_report_status ${precmd_functions:#__is_report_status})