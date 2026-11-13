if [ -z "$ISTERM_LOGIN" ]; then
	if [ -r ~/.bashrc ]; then
		. ~/.bashrc
	fi
else
	if [ -r /etc/profile ]; then
		. /etc/profile
	fi
	# execute the first that exists
	if [ -r ~/.bash_profile ]; then
		. ~/.bash_profile
	elif [ -r ~/.bash_login ]; then
		. ~/.bash_login
	elif [ -r ~/.profile ]; then
		. ~/.profile
	fi
fi

__is_shell_source="${BASH_SOURCE[0]}"
if command -v cygpath > /dev/null 2>&1; then
	__is_shell_source=$(cygpath -u "$__is_shell_source")
fi

if [ -r "${__is_shell_source%/*}/bash-preexec.sh" ]; then
	. "${__is_shell_source%/*}/bash-preexec.sh"
fi
unset __is_shell_source

__is_prompt_start() {
	builtin printf '\e]6973;PS\a'
}

__is_prompt_end() {
	builtin printf '\e]6973;PE\a'
}

__is_escape_value() {
	# Process text byte by byte, not by codepoint.
	builtin local LC_ALL=C str="${1}" i byte token out=''

	for (( i=0; i < "${#str}"; ++i )); do
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

	builtin printf '%s\n' "${out}"
}

__is_update_cwd() {
	local __is_dir=$PWD
	# Git Bash and Cygwin: the Windows path (C:\Users\...), since /tmp or /home are mounts that only bash knows
	if [[ "$OSTYPE" == msys* || "$OSTYPE" == cygwin* ]]; then
		if [[ "$PWD" != "$__is_cwd_seen" ]]; then
			__is_cwd_seen=$PWD
			__is_cwd_win=$(builtin pwd -W 2>/dev/null || cygpath -w "$PWD" 2>/dev/null || builtin printf '%s' "$PWD")
		fi
		__is_dir=$__is_cwd_win
	fi
	builtin printf '\e]6973;CWD;%s\a' "$(__is_escape_value "$__is_dir")"
}

if [[ -n "${bash_preexec_imported:-}" ]]; then
    precmd_functions+=(__is_precmd)
fi

# the exit code of the command that just ran, so a failed one can be offered a fix at the next prompt
__is_report_status() {
	builtin printf '\e]6973;EX;%s\a' "$1"
}

# the exported variables, so the commands behind the lists (kubectl, aws, git) run with what this shell has, not with
# what terminalhinter saw when it started at the top of .bashrc. Written to terminalhinter's private file when
# something changed, and only a short ENV goes through the terminal.
__is_report_env() {
	[[ -n "$ISTERM_ENV_FILE" ]] || return
	builtin local name out='' rs=$'\x1e'
	for name in $(builtin compgen -e); do
		case $name in _|PWD|OLDPWD|SHLVL|BASH_*) continue ;; esac
		out+="${name}=${!name}${rs}"
	done
	[[ "$out" == "$__is_last_env" ]] && return
	builtin printf '%s' "$out" >| "$ISTERM_ENV_FILE" 2>/dev/null || return
	__is_last_env=$out
	builtin printf '\e]6973;ENV\a'
}

__is_precmd() {
	__is_report_status "${1:-$?}"
	__is_report_env
	__is_update_cwd
	__is_update_prompt
}

__is_update_prompt() {
	if [[ "$__is_custom_PS1" == "" || "$__is_custom_PS1" != "$PS1" ]]; then
        __is_original_PS1=$PS1
		if [[ $ISTERM_TESTING == "1" ]]; then
			__is_original_PS1="> "
		fi
        __is_custom_PS1="\[$(__is_prompt_start)\]$__is_original_PS1\[$(__is_prompt_end)\]"
        PS1="$__is_custom_PS1"
    fi
}

__is_prompt_cmd_original() {
	local __is_status=$?
	for cmd in "${__is_original_prompt_command[@]}"; do
		eval "${cmd:-}"
	done
	__is_precmd "$__is_status"
}

# handles when a user's PROMPT_COMMAND resets their prompt after the precmd hook is triggered
__is_prompt_cmd_safe() {
	local __is_status=$?
	for cmd in "${__is_original_prompt_command[@]}"; do
		eval "${cmd:-}"
	done
	if [[ "$PS1" != "$__is_safe_PS1" ]]; then 
		__is_precmd "$__is_status"
		__is_safe_PS1="$PS1"
	fi
}

__is_original_prompt_command=${PROMPT_COMMAND:-}
if [[ -z "${bash_preexec_imported:-}" ]]; then
	if [[ -n "${__is_original_prompt_command:-}" && "${__is_original_prompt_command:-}" != "__is_precmd" ]]; then
		PROMPT_COMMAND=__is_prompt_cmd_original
	else
		PROMPT_COMMAND=__is_precmd
	fi
else
	if [[ -n "${__is_original_prompt_command:-}" && "${__is_original_prompt_command:-}" != "__is_precmd" ]]; then 
		PROMPT_COMMAND=__is_prompt_cmd_safe
	fi
fi

__is_precmd