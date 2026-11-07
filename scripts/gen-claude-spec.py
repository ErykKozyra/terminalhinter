# Writes src/specs/claude.ts from the --help output of the installed Claude Code: python3 scripts/gen-claude-spec.py > src/specs/claude.ts
import subprocess, re, json, sys
def helptext(path):
    try:
        return subprocess.run(["claude", *path, "--help"], capture_output=True, text=True, timeout=20, stdin=subprocess.DEVNULL).stdout
    except Exception: return ""
def section(text, name):
    m = re.search(rf"^{name}:\n(.*?)(?=^\S|\Z)", text, re.S | re.M)
    if not m: return []
    items, cur = [], None
    for line in m.group(1).split("\n"):
        if not line.strip(): continue
        mm = re.match(r"^  (\S.*?)(?:\s{2,}(.*))?$", line)
        if mm and not line.startswith("    " + " " * 20) and re.match(r"^  \S", line):
            cur = [mm.group(1).strip(), (mm.group(2) or "").strip()]; items.append(cur)
        elif cur is not None:
            cur[1] = (cur[1] + " " + line.strip()).strip()
    return items
def first_sentence(d):
    d = re.sub(r"\s+", " ", d).strip()
    m = re.match(r"(.+?[.!?])(\s|$)", d)
    return (m.group(1) if m else d)[:160]
def parse_args(sig):
    args = []
    for a in re.findall(r"(<[^>]+>|\[[^\]]+\])", sig):
        name = a[1:-1]; opt = a.startswith("[")
        var = name.endswith("...")
        args.append({"name": name.rstrip(".") , **({"isOptional": True} if opt else {}), **({"isVariadic": True} if var else {})})
    return args
def option(sig, desc):
    head = sig.split(" <")[0].split(" [")[0]
    names = [n.strip() for n in head.split(",")]
    o = {"name": names if len(names) > 1 else names[0], "description": first_sentence(desc)}
    a = parse_args(sig[len(head):])
    if a: o["args"] = a[0] if len(a) == 1 else a
    return o
def node(path, depth):
    t = helptext(path)
    n = {}
    opts = [option(s, d) for s, d in section(t, "Options") if not s.startswith("-h,") and not s.startswith("-V,")]
    if opts: n["options"] = opts
    subs = []
    for sig, desc in section(t, "Commands"):
        name = sig.split(" ")[0]
        if name == "help": continue
        names = name.split("|")
        sub = {"name": names if len(names) > 1 else names[0], "description": first_sentence(desc)}
        a = parse_args(sig[len(name):])
        if a: sub["args"] = a[0] if len(a) == 1 else a
        if depth < 2: sub.update(node(path + [names[0]], depth + 1))
        subs.append(sub)
    if subs: n["subcommands"] = subs
    return n
spec = {"name": "claude", "description": "Claude Code, Anthropic's coding agent in your terminal", "args": {"name": "prompt", "isOptional": True}}
spec.update(node([], 0))
version = subprocess.run(["claude", "--version"], capture_output=True, text=True).stdout.split()[0]
print(f"// Copyright (c) 2026 Eryk Kozyra.\n// Licensed under the MIT License.\n\n// Generated from `claude --help` of Claude Code {version} (scripts/gen-claude-spec.py); the withfig one is older.\n\nconst completionSpec: Fig.Spec = " + json.dumps(spec, indent=2) + ";\n\nexport default completionSpec;")
