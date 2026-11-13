function __is_copy_function; functions $argv[1] | sed "s/^function $argv[1]/function $argv[2]/" | source; end
function __is_prompt_start; printf '\e]6973;PS\a'; end
function __is_prompt_end; printf '\e]6973;PE\a'; end

__is_copy_function fish_prompt is_user_prompt

function __is_escape_value
	echo $argv \
	| string replace -a '\\' '\\\\' \
	| string replace -a ';' '\\x3b' \
	| string replace -a \e '\\x1b' \
	| string replace -a \a '\\x07' \
	| string split \n | string join '\x0a' \
	;
end
# the exported variables, so the commands behind the lists (kubectl, aws, git) run with what this shell has, not with
# what terminalhinter saw when it started. Written to terminalhinter's private file when something changed, and only
# a short ENV goes through the terminal.
function __is_report_env --on-event fish_prompt
	set -q ISTERM_ENV_FILE; or return
	set --local entries
	for name in (set --names --export)
		contains -- $name _ PWD OLDPWD SHLVL; and continue
		if string match -q -- '*PATH' $name
			set --append entries "$name="(string join : -- $$name)
		else
			set --append entries "$name="(string join ' ' -- $$name)
		end
	end
	set --local joined (string join \x1e -- $entries)
	test "$joined" = "$__is_last_env"; and return
	printf '%s\x1e' $entries >$ISTERM_ENV_FILE 2>/dev/null; or return
	set --global __is_last_env $joined
	printf '\e]6973;ENV\a'
end
function __is_update_cwd --on-event fish_prompt; set __is_cwd (__is_escape_value "$PWD"); printf "\e]6973;CWD;%s\a" $__is_cwd; end

if [ "$ISTERM_TESTING" = "1" ]
	function is_user_prompt; printf '> '; end
	set -Ua fish_features no-query-term
end

# the exit code of the command that just ran, so a failed one can be offered a fix at the next prompt
function __is_report_status; printf '\e]6973;EX;%s\a' $argv[1]; end

function fish_prompt;
    set --local __is_status $status
    __is_report_status $__is_status
    set --local __user_prompt_lines (is_user_prompt)
    set --local __user_prompt (string join '\n' $__user_prompt_lines)
	set --local __prompt (string join '' (__is_prompt_start) $__user_prompt (__is_prompt_end))
    # Pass the prompt as data so a literal % is not a printf conversion.
    printf '%s' $__prompt
end