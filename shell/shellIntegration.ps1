$Global:__IsOriginalPrompt = $function:Prompt

function Global:__IsTestingPrompt() {
    return "PS > "
}
if ($env:ISTERM_TESTING -eq "1") {
    $Global:__IsOriginalPrompt = $function:__IsTestingPrompt
}

function Global:__IS-Escape-Value([string]$value) {
    [regex]::Replace($value, "[$([char]0x1b)$([char]0x07)\\\n;]", { param($match)
            -Join (
                [System.Text.Encoding]::UTF8.GetBytes($match.Value) | ForEach-Object { '\x{0:x2}' -f $_ }
            )
        })
}

# the environment variables, so the commands behind the lists (kubectl, aws, git) run with what this shell has, not
# with what terminalhinter saw when it started; sent only when something changed. 0x1e separates them.
function Global:__IS-Escape-Env([string]$value) {
    [regex]::Replace($value, "[$([char]0x1b)$([char]0x07)$([char]0x1e)\\\n;]", { param($match)
            -Join (
                [System.Text.Encoding]::UTF8.GetBytes($match.Value) | ForEach-Object { '\x{0:x2}' -f $_ }
            )
        })
}

function Global:__IS-Report-Env() {
    $Entries = foreach ($Var in Get-ChildItem env:) {
        if ($Var.Name -in @('_', 'PWD', 'OLDPWD', 'SHLVL')) { continue }
        "$($Var.Name)=$($Var.Value)"
    }
    $Joined = $Entries -join [char]0x1e
    if ($Joined -ceq $Global:__IsLastEnv) { return "" }
    $Global:__IsLastEnv = $Joined
    return "$([char]0x1b)]6973;ENV;$(__IS-Escape-Env $Joined)`a"
}

function Global:Prompt() {
    # the exit code of the command that just ran, so a failed one can be offered a fix at the next prompt
    $IsOk = $?
    $IsCode = $Global:LASTEXITCODE
    $IsStatus = if ($IsOk) { 0 } elseif ($IsCode) { $IsCode } else { 1 }
    $Result = "$([char]0x1b)]6973;EX;$IsStatus`a"
    $Result += __IS-Report-Env
    $Result += "$([char]0x1b)]6973;PS`a"
    $OriginalPrompt += $Global:__IsOriginalPrompt.Invoke()
    $Result += $OriginalPrompt
    $Result += "$([char]0x1b)]6973;PE`a"

    $Result += if ($pwd.Provider.Name -eq 'FileSystem') { "$([char]0x1b)]6973;CWD;$(__IS-Escape-Value $pwd.ProviderPath)`a" }
    return $Result
}