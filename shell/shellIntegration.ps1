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

function Global:Prompt() {
    # the exit code of the command that just ran, so a failed one can be offered a fix at the next prompt
    $IsOk = $?
    $IsCode = $Global:LASTEXITCODE
    $IsStatus = if ($IsOk) { 0 } elseif ($IsCode) { $IsCode } else { 1 }
    $Result = "$([char]0x1b)]6973;EX;$IsStatus`a"
    $Result += "$([char]0x1b)]6973;PS`a"
    $OriginalPrompt += $Global:__IsOriginalPrompt.Invoke()
    $Result += $OriginalPrompt
    $Result += "$([char]0x1b)]6973;PE`a"

    $Result += if ($pwd.Provider.Name -eq 'FileSystem') { "$([char]0x1b)]6973;CWD;$(__IS-Escape-Value $pwd.ProviderPath)`a" }
    return $Result
}