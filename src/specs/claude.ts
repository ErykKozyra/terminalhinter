// Copyright (c) 2026 Eryk Kozyra.
// Licensed under the MIT License.

// Generated from `claude --help` of Claude Code 2.1.319 by scripts/gen-claude-spec.py; the spec in withfig is much older.

const completionSpec: Fig.Spec = {
  name: "claude",
  description: "Claude Code, Anthropic's coding agent in your terminal",
  args: {
    name: "prompt",
    isOptional: true,
  },
  options: [
    {
      name: "--add-dir",
      description: "Additional directories to allow tool access to",
      args: {
        name: "directories",
        isVariadic: true,
      },
    },
    {
      name: "--agent",
      description: "Agent for the current session.",
      args: {
        name: "agent",
      },
    },
    {
      name: "--agents",
      description: "JSON object defining custom agents, or with --print the path to a file that holds one (e.g.",
      args: {
        name: "json-or-file",
      },
    },
    {
      name: "--allow-dangerously-skip-permissions",
      description: "Enable bypassing all permission checks as an option, without it being enabled by default.",
    },
    {
      name: ["--allowedTools", "--allowed-tools"],
      description: "Comma or space-separated list of tool names to allow (e.g.",
      args: {
        name: "tools",
        isVariadic: true,
      },
    },
    {
      name: "--append-system-prompt",
      description: "Append a system prompt to the default system prompt",
      args: {
        name: "prompt",
      },
    },
    {
      name: "--autocompact",
      description: "Auto-compact window size (auto, or 100k\u20131M tokens)",
      args: {
        name: "auto|tokens",
      },
    },
    {
      name: "--ax-screen-reader",
      description: "Render screen-reader friendly output (flat text, no decorative borders or animations).",
    },
    {
      name: ["--bg", "--background"],
      description: "Start the session in the background and return immediately.",
    },
    {
      name: "--bare",
      description:
        "Minimal mode: skip hooks (those defined in settings and by installed plugins; features built into Claude Code are unaffected), LSP, plugin sync, attribution, au",
    },
    {
      name: "--betas",
      description: "Beta headers to include in API requests (API key users only)",
      args: {
        name: "betas",
        isVariadic: true,
      },
    },
    {
      name: "--brief",
      description: "Enable SendUserMessage tool for agent-to-user communication",
    },
    {
      name: "--chrome",
      description: "Enable Claude in Chrome integration",
    },
    {
      name: "--cloud",
      description: "Create a cloud session with the given description, or attach to an existing one by session ID or claude.ai/code URL",
      args: {
        name: "description|session_id|url",
        isOptional: true,
      },
    },
    {
      name: ["-c", "--continue"],
      description: "Continue the most recent conversation in the current directory",
    },
    {
      name: "--dangerously-skip-permissions",
      description: "Bypass all permission checks.",
    },
    {
      name: ["-d", "--debug"],
      description: "Enable debug mode with optional category filtering (e.g., --debug=hooks,mcp or --debug='!hooks,!mcp')",
      args: {
        name: "filter",
        isOptional: true,
      },
    },
    {
      name: "--debug-file",
      description: "Write debug logs to a specific file path (implicitly enables debug mode)",
      args: {
        name: "path",
      },
    },
    {
      name: "--desktop",
      description: "Open in the Claude Desktop app instead of the terminal (with --continue or --resume <id> to pick the session)",
    },
    {
      name: "--disable-slash-commands",
      description: "Disable all skills and commands",
    },
    {
      name: ["--disallowedTools", "--disallowed-tools"],
      description: "Comma or space-separated list of tool names to deny (e.g.",
      args: {
        name: "tools",
        isVariadic: true,
      },
    },
    {
      name: "--effort",
      description: "Effort level for the current session (low, medium, high, xhigh, max)",
      args: {
        name: "level",
      },
    },
    {
      name: "--environment",
      description: "Create a new cloud session that runs on the given self-hosted environment (ccpool_...).",
      args: {
        name: "environment_id",
      },
    },
    {
      name: "--exclude-dynamic-system-prompt-sections",
      description: "Move per-machine sections (cwd, env info, memory paths, git status) from the system prompt into the first user message.",
    },
    {
      name: "--fallback-model",
      description: "Enable automatic fallback to specified model(s) when the default model is overloaded or not available.",
      args: {
        name: "model",
      },
    },
    {
      name: "--file",
      description: "File resources to download at startup.",
      args: {
        name: "specs",
        isVariadic: true,
      },
    },
    {
      name: "--fork-session",
      description: "When resuming, create a new session ID instead of reusing the original (use with --resume or --continue)",
    },
    {
      name: "--forward-subagent-text",
      description:
        "Forward subagent text and thinking blocks as assistant/user messages with parent_tool_use_id set (only works with --print and --output-format=stream-json)",
    },
    {
      name: "--from-pr",
      description: "Resume a session linked to a PR by PR number/URL, or open interactive picker with optional search term",
      args: {
        name: "value",
        isOptional: true,
      },
    },
    {
      name: "--ide",
      description: "Automatically connect to IDE on startup if exactly one valid IDE is available",
    },
    {
      name: "--include-hook-events",
      description: "Include all hook lifecycle events in the output stream (only works with --output-format=stream-json)",
    },
    {
      name: "--include-partial-messages",
      description: "Include partial message chunks as they arrive (only works with --print and --output-format=stream-json)",
    },
    {
      name: "--input-format",
      description: 'Input format (only works with --print): "text" (default), or "stream-json" (realtime streaming input) (choices: "text", "stream-json")',
      args: {
        name: "format",
      },
    },
    {
      name: "--json-schema",
      description: "JSON Schema for structured output validation (only works with --print).",
      args: {
        name: "schema",
      },
    },
    {
      name: "--max-budget-usd",
      description: "Maximum dollar amount to spend on API calls (only works with --print)",
      args: {
        name: "amount",
      },
    },
    {
      name: "--mcp-config",
      description: "Load MCP servers from JSON files or strings (space-separated)",
      args: {
        name: "configs",
        isVariadic: true,
      },
    },
    {
      name: "--model",
      description: "Model for the current session.",
      args: {
        name: "model",
      },
    },
    {
      name: ["-n", "--name"],
      description: "Set a display name for this session (shown in the prompt box, /resume picker, and terminal title)",
      args: {
        name: "name",
      },
    },
    {
      name: "--no-chrome",
      description: "Disable Claude in Chrome integration",
    },
    {
      name: "--no-session-persistence",
      description: "Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print)",
    },
    {
      name: "--output-format",
      description:
        'Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming) (choices: "text", "json", "stream-json"',
      args: {
        name: "format",
      },
    },
    {
      name: "--permission-mode",
      description: 'Permission mode to use for the session (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan")',
      args: {
        name: "mode",
      },
    },
    {
      name: "--permission-prompts",
      description:
        'Who answers permission prompts with --print: "host" (the SDK host or --permission-prompt-tool) or "none" (nobody: anything that would prompt is denied automatic',
      args: {
        name: "target",
      },
    },
    {
      name: "--plugin-dir",
      description:
        "Load a plugin from a directory or .zip for this session only; a folder of plugins loads each child (repeatable: --plugin-dir A --plugin-dir B.zip) (default: [])",
      args: {
        name: "path",
      },
    },
    {
      name: "--plugin-url",
      description: "Fetch a plugin .zip from a URL for this session only (repeatable: --plugin-url A --plugin-url B) (default: [])",
      args: {
        name: "url",
      },
    },
    {
      name: ["-p", "--print"],
      description: "Print response and exit (useful for pipes).",
    },
    {
      name: "--prompt-suggestions",
      description: "Enable prompt suggestions.",
      args: {
        name: "value",
        isOptional: true,
      },
    },
    {
      name: "--remote-control",
      description: "Start an interactive session with Remote Control enabled (optionally named)",
      args: {
        name: "name",
        isOptional: true,
      },
    },
    {
      name: "--remote-control-session-name-prefix",
      description: "Prefix for auto-generated Remote Control session names (default: hostname)",
      args: {
        name: "prefix",
      },
    },
    {
      name: "--replay-user-messages",
      description:
        "Re-emit user messages from stdin back on stdout for acknowledgment (only works with --input-format=stream-json and --output-format=stream-json)",
    },
    {
      name: "--restricted",
      description:
        "Restricted mode: removes the built-in tools that run commands or code (Bash, PowerShell and the other code-running tools) and WebFetch unless --tools names them",
    },
    {
      name: ["-r", "--resume"],
      description: "Resume a conversation by session ID or name, or open interactive picker with optional search term",
      args: {
        name: "value",
        isOptional: true,
      },
    },
    {
      name: "--safe-mode",
      description:
        "Start with all customizations (CLAUDE.md, skills, installed plugins, hooks, MCP servers, custom commands and agents, output styles, workflows, custom themes, ke",
    },
    {
      name: "--session-id",
      description: "Use a specific session ID for the conversation (must be a valid UUID)",
      args: {
        name: "uuid",
      },
    },
    {
      name: "--setting-sources",
      description: "Comma-separated list of setting sources to load (user, project, local).",
      args: {
        name: "sources",
      },
    },
    {
      name: "--settings",
      description: "Path to a settings JSON file or a JSON string to load additional settings from",
      args: {
        name: "file-or-json",
      },
    },
    {
      name: "--strict-mcp-config",
      description: "Only use MCP servers from --mcp-config, ignoring all other MCP configurations",
    },
    {
      name: "--system-prompt",
      description: "System prompt to use for the session",
      args: {
        name: "prompt",
      },
    },
    {
      name: "--system-prompt-snapshot",
      description: "Record the system prompt once per conversation and reuse it verbatim on every request and resume.",
      args: {
        name: "on|off",
      },
    },
    {
      name: "--teleport",
      description: "Resume a teleport session, optionally specify session ID",
      args: {
        name: "session",
        isOptional: true,
      },
    },
    {
      name: "--tmux",
      description: "Create a tmux session for the worktree (requires --worktree).",
    },
    {
      name: "--tools",
      description: "Specify the list of available tools from the built-in set.",
      args: {
        name: "tools",
        isVariadic: true,
      },
    },
    {
      name: "--verbose",
      description: "Override verbose mode setting from config",
    },
    {
      name: ["-v", "--version"],
      description: "Output the version number",
    },
    {
      name: ["-w", "--worktree"],
      description: "Create a new git worktree for this session (optionally specify a name)",
      args: {
        name: "name",
        isOptional: true,
      },
    },
  ],
  subcommands: [
    {
      name: "agents",
      description: "Manage background agents",
      args: {
        name: "options",
        isOptional: true,
      },
      options: [
        {
          name: "--add-dir",
          description: "Additional directory to allow tool access to in dispatched sessions (repeatable)",
          args: {
            name: "directory",
          },
        },
        {
          name: "--agent",
          description: "Default agent for sessions dispatched from agent view.",
          args: {
            name: "agent",
          },
        },
        {
          name: "--all",
          description: "With --json: also include completed background sessions",
        },
        {
          name: "--allow-dangerously-skip-permissions",
          description: "Make bypass-permissions mode available to dispatched sessions without defaulting to it",
        },
        {
          name: "--cwd",
          description: "Show only background sessions started under <path>",
          args: {
            name: "path",
          },
        },
        {
          name: "--dangerously-skip-permissions",
          description: "Alias for --permission-mode bypassPermissions",
        },
        {
          name: "--effort",
          description: "Default effort level for sessions dispatched from agent view",
          args: {
            name: "level",
          },
        },
        {
          name: "--json",
          description: "Print active sessions (interactive and background) as a JSON array and exit (for scripting; does not require a TTY)",
        },
        {
          name: "--mcp-config",
          description: "MCP server configuration to apply to dispatched sessions (repeatable)",
          args: {
            name: "config",
          },
        },
        {
          name: "--model",
          description: "Default model for sessions dispatched from agent view",
          args: {
            name: "model",
          },
        },
        {
          name: "--permission-mode",
          description: "Default permission mode for sessions dispatched from agent view",
          args: {
            name: "mode",
          },
        },
        {
          name: "--plugin-dir",
          description: "Load plugins from specified directory for the agent view and dispatched sessions; a folder of plugins loads each child (repeatable)",
          args: {
            name: "path",
          },
        },
        {
          name: "--restricted",
          description: "Start dispatched sessions in restricted mode",
        },
        {
          name: "--setting-sources",
          description: "Comma-separated list of setting sources to load (user, project, local).",
          args: {
            name: "sources",
          },
        },
        {
          name: "--settings",
          description: "Settings file or JSON string to apply to the agent view and dispatched sessions",
          args: {
            name: "file-or-json",
          },
        },
        {
          name: "--strict-mcp-config",
          description: "Only use MCP servers from --mcp-config in dispatched sessions",
        },
      ],
    },
    {
      name: "attach",
      description: "Open a background session in this terminal.",
      args: {
        name: "id|name",
      },
    },
    {
      name: "auth",
      description: "Manage authentication",
      subcommands: [
        {
          name: "login",
          description: "Sign in to your Anthropic account",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: "--claudeai",
              description: "Use Claude subscription (default)",
            },
            {
              name: "--console",
              description: "Use Anthropic Console (API usage billing) instead of Claude subscription",
            },
            {
              name: "--email",
              description: "Pre-populate email address on the login page",
              args: {
                name: "email",
              },
            },
            {
              name: "--sso",
              description: "Force SSO login flow",
            },
          ],
        },
        {
          name: "logout",
          description: "Log out from your Anthropic account",
        },
        {
          name: "status",
          description: "Show authentication status",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: "--json",
              description: "Output as JSON (default)",
            },
            {
              name: "--text",
              description: "Output as human-readable text",
            },
          ],
        },
      ],
    },
    {
      name: "auto-mode",
      description: "Inspect or reset auto mode configuration",
      subcommands: [
        {
          name: "config",
          description: "Print the effective auto mode config as JSON: your settings where set, defaults otherwise",
        },
        {
          name: "critique",
          description: "Get AI feedback on your custom auto mode rules",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: "--model",
              description: "Override which model is used",
              args: {
                name: "model",
              },
            },
          ],
        },
        {
          name: "defaults",
          description: "Print the default auto mode environment, allow, soft_deny, and hard_deny rules as JSON",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: "--label",
              description: "Show only rules whose label starts with this prefix (case-insensitive)",
              args: {
                name: "prefix",
              },
            },
          ],
        },
        {
          name: "reset",
          description: "Reset auto mode configuration to the shipped defaults by removing the autoMode section from your user settings file",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: ["-y", "--yes"],
              description: "Skip the confirmation prompt",
            },
          ],
        },
      ],
    },
    {
      name: "doctor",
      description: "Check the health of your Claude Code installation.",
    },
    {
      name: "gateway",
      description: "Run the enterprise auth/telemetry gateway",
      args: {
        name: "options",
        isOptional: true,
      },
      options: [
        {
          name: "--config",
          description: "Path to gateway YAML config",
          args: {
            name: "path",
          },
        },
      ],
    },
    {
      name: "import",
      description: "Import config from another AI coding agent into Claude Code",
      args: [
        {
          name: "options",
          isOptional: true,
        },
        {
          name: "source",
          isOptional: true,
        },
      ],
      options: [
        {
          name: "--dry-run",
          description: "Show what would be imported without writing anything",
        },
        {
          name: "--yes",
          description: "Skip the interactive picker.",
        },
      ],
    },
    {
      name: "install",
      description: "Install Claude Code native build.",
      args: [
        {
          name: "options",
          isOptional: true,
        },
        {
          name: "target",
          isOptional: true,
        },
      ],
      options: [
        {
          name: "--force",
          description: "Force installation even if already installed",
        },
      ],
    },
    {
      name: "logs",
      description: "Print a background session's recent terminal output",
      args: {
        name: "id|name",
      },
    },
    {
      name: "mcp",
      description: "Configure and manage MCP servers",
      subcommands: [
        {
          name: "add",
          description: "Add an MCP server to Claude Code.",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "name",
            },
            {
              name: "commandOrUrl",
            },
            {
              name: "args",
              isOptional: true,
              isVariadic: true,
            },
          ],
          options: [
            {
              name: "--callback-port",
              description: "Fixed port for OAuth callback (for servers requiring pre-registered redirect URIs)",
              args: {
                name: "port",
              },
            },
            {
              name: "--client-id",
              description: "OAuth client ID for HTTP/SSE servers",
              args: {
                name: "clientId",
              },
            },
            {
              name: "--client-secret",
              description: "Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)",
            },
            {
              name: ["-e", "--env"],
              description: "Set environment variables (e.g.",
              args: {
                name: "env",
                isVariadic: true,
              },
            },
            {
              name: ["-H", "--header"],
              description: "Set headers for HTTP/SSE servers (e.g.",
              args: {
                name: "header",
                isVariadic: true,
              },
            },
            {
              name: ["-s", "--scope"],
              description: 'Configuration scope (local, user, or project) (default: "local")',
              args: {
                name: "scope",
              },
            },
            {
              name: ["-t", "--transport"],
              description: "Transport type (stdio, sse, http).",
              args: {
                name: "transport",
              },
            },
          ],
        },
        {
          name: "Examples:",
          description:
            "# Add HTTP server: claude mcp add --transport http sentry https://mcp.sentry.dev/mcp # Add HTTP server with headers: claude mcp add --transport http corridor ht",
          subcommands: [
            {
              name: "add",
              description: "Add an MCP server to Claude Code.",
              args: [
                {
                  name: "options",
                  isOptional: true,
                },
                {
                  name: "name",
                },
                {
                  name: "commandOrUrl",
                },
                {
                  name: "args",
                  isOptional: true,
                  isVariadic: true,
                },
              ],
            },
            {
              name: "Examples:",
              description:
                "# Add HTTP server: claude mcp add --transport http sentry https://mcp.sentry.dev/mcp # Add HTTP server with headers: claude mcp add --transport http corridor ht",
            },
            {
              name: "add-from-claude-desktop",
              description: "Import MCP servers from Claude Desktop (Mac and WSL only)",
              args: {
                name: "options",
                isOptional: true,
              },
            },
            {
              name: "add-json",
              description: "Add an MCP server (stdio, SSE, HTTP, or WebSocket) with a JSON string",
              args: [
                {
                  name: "options",
                  isOptional: true,
                },
                {
                  name: "name",
                },
                {
                  name: "json",
                },
              ],
            },
            {
              name: "get",
              description: "Get details about an MCP server.",
              args: {
                name: "name",
              },
            },
            {
              name: "list",
              description: "List configured MCP servers.",
            },
            {
              name: "login",
              description: "Authenticate with an MCP server (HTTP, SSE, or claude.ai connector)",
              args: [
                {
                  name: "options",
                  isOptional: true,
                },
                {
                  name: "name",
                },
              ],
            },
            {
              name: "logout",
              description: "Clear stored OAuth credentials for an MCP server",
              args: {
                name: "name",
              },
            },
            {
              name: "remove",
              description: "Remove an MCP server",
              args: [
                {
                  name: "options",
                  isOptional: true,
                },
                {
                  name: "name",
                },
              ],
            },
            {
              name: "reset-project-choices",
              description: "Reset all approved and rejected project-scoped (.mcp.json) servers within this project",
            },
            {
              name: "serve",
              description: "Start the Claude Code MCP server",
              args: {
                name: "options",
                isOptional: true,
              },
            },
          ],
        },
        {
          name: "add-from-claude-desktop",
          description: "Import MCP servers from Claude Desktop (Mac and WSL only)",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: ["-s", "--scope"],
              description: 'Configuration scope (local, user, or project) (default: "local")',
              args: {
                name: "scope",
              },
            },
          ],
        },
        {
          name: "add-json",
          description: "Add an MCP server (stdio, SSE, HTTP, or WebSocket) with a JSON string",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "name",
            },
            {
              name: "json",
            },
          ],
          options: [
            {
              name: "--client-secret",
              description: "Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)",
            },
            {
              name: ["-s", "--scope"],
              description: 'Configuration scope (local, user, or project) (default: "local")',
              args: {
                name: "scope",
              },
            },
          ],
        },
        {
          name: "get",
          description: "Get details about an MCP server.",
          args: {
            name: "name",
          },
        },
        {
          name: "list",
          description: "List configured MCP servers.",
        },
        {
          name: "login",
          description: "Authenticate with an MCP server (HTTP, SSE, or claude.ai connector)",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "name",
            },
          ],
          options: [
            {
              name: "--no-browser",
              description:
                "Print the authorization URL instead of opening a browser (for SSH/headless sessions \u2014 paste the redirect URL back when prompted)",
            },
          ],
        },
        {
          name: "logout",
          description: "Clear stored OAuth credentials for an MCP server",
          args: {
            name: "name",
          },
        },
        {
          name: "remove",
          description: "Remove an MCP server",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "name",
            },
          ],
          options: [
            {
              name: ["-s", "--scope"],
              description: "Configuration scope (local, user, or project) - if not specified, removes from whichever scope it exists in",
              args: {
                name: "scope",
              },
            },
          ],
        },
        {
          name: "reset-project-choices",
          description: "Reset all approved and rejected project-scoped (.mcp.json) servers within this project",
        },
        {
          name: "serve",
          description: "Start the Claude Code MCP server",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: ["-d", "--debug"],
              description: "Enable debug mode",
            },
            {
              name: "--port",
              description: "Port to listen on with --transport http (default 0 = kernel-assigned; bound to 127.0.0.1 only)",
              args: {
                name: "port",
              },
            },
            {
              name: "--result-format",
              description:
                'Tool result content: raw (JSON of the tool output) or rendered (the text the model would see) (choices: "raw", "rendered", default: "raw")',
              args: {
                name: "format",
              },
            },
            {
              name: "--session-tunnel",
              description:
                "With --transport http --port 28471: dial the session tunnel that relays tool calls; reads one line of JSON (session id, token, API address) from standard input",
            },
            {
              name: "--transport",
              description: 'Transport for MCP JSON-RPC (choices: "stdio", "http", default: "stdio")',
              args: {
                name: "transport",
              },
            },
            {
              name: "--verbose",
              description: "Override verbose mode setting from config",
            },
          ],
        },
      ],
    },
    {
      name: ["plugin", "plugins"],
      description: "Manage Claude Code plugins",
      subcommands: [
        {
          name: "configure",
          description: "Show a plugin's options and which are unset, or save values from stdin with --values-stdin",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "plugin",
            },
          ],
          options: [
            {
              name: "--json",
              description: "Output as JSON",
            },
            {
              name: "--values-stdin",
              description: "Read option values from stdin as a JSON object of single-line strings; options left out keep their values",
            },
          ],
        },
        {
          name: "details",
          description: "Show a plugin's component inventory and projected token cost",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "name",
            },
          ],
        },
        {
          name: "disable",
          description: "Disable an enabled plugin",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "plugin",
              isOptional: true,
            },
          ],
          options: [
            {
              name: ["-a", "--all"],
              description: "Disable all enabled plugins",
            },
            {
              name: "--json",
              description: "Print one machine-readable result line on stdout instead of the human message (same exit codes)",
            },
            {
              name: ["-s", "--scope"],
              description: "Installation scope: user, project, local (default: auto-detect)",
              args: {
                name: "scope",
              },
            },
          ],
        },
        {
          name: "enable",
          description: "Enable a disabled plugin",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "plugin",
            },
          ],
          options: [
            {
              name: "--json",
              description: "Print one machine-readable result line on stdout instead of the human message (same exit codes)",
            },
            {
              name: ["-s", "--scope"],
              description: "Installation scope: user, project, local (default: auto-detect)",
              args: {
                name: "scope",
              },
            },
          ],
        },
        {
          name: "eval",
          description:
            "Run eval cases (<eval dir>/**/case.yaml or prompt.md + graders/*.md; the eval dir is evals/ unless --eval-dir or the manifest says otherwise) against a plugin a",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "target",
              isOptional: true,
            },
          ],
          options: [
            {
              name: "--ablation",
              description:
                "Run a no-plugin baseline arm and report the score delta (none | with-without; default: with-without whenever a plugin resolves \u2014 by name, or from the target pat",
              args: {
                name: "mode",
              },
            },
            {
              name: "--allow-real-servers",
              description:
                "With --mocks record: also start the plugin's REAL MCP server processes for servers that have no mock (they run as you, outside the OS sandbox that confines shel",
            },
            {
              name: "--allow-tools",
              description: "Operator grant for gated tools (Bash, Write, Edit, WebFetch, mcp__*).",
              args: {
                name: "tools",
                isVariadic: true,
              },
            },
            {
              name: "--case",
              description: "Filter cases by name glob",
              args: {
                name: "glob",
              },
            },
            {
              name: ["-j", "--concurrency"],
              description: "Run up to <n> agent runs at once (1-8; default 1).",
              args: {
                name: "n",
              },
            },
            {
              name: "--disallow-tools",
              description: "Built-in tools to keep from Claude in every case, even if granted (e.g.",
              args: {
                name: "tools",
                isVariadic: true,
              },
            },
            {
              name: "--eval-dir",
              description:
                "Directory name (below the plugin) that holds the eval cases; results go to <plugin>/<dir>/results/ \u2014 for an installed-plugin target, ./<dir>/results/ with this ",
              args: {
                name: "dir",
              },
            },
            {
              name: "--json",
              description: "Print the full run result (prompts, graders, per-run scores) as JSON to stdout, or write it to this .json file",
              args: {
                name: "path",
                isOptional: true,
              },
            },
            {
              name: "--judge-model",
              description: "Override LLM-grader model (default: haiku)",
              args: {
                name: "model",
              },
            },
            {
              name: "--keep-temp",
              description: "Preserve scaffold dirs for debugging",
            },
            {
              name: "--max-cost-usd",
              description: "Optional hard cost ceiling; abort and report partial results if hit (exit 2).",
              args: {
                name: "usd",
              },
            },
            {
              name: "--mocks",
              description: "Mock stand-ins for MCP servers, from <eval dir>/mocks/ (record | off; default: record).",
              args: {
                name: "mode",
              },
            },
            {
              name: "--model",
              description: "Override model for all cases",
              args: {
                name: "model",
              },
            },
            {
              name: "--no-publish",
              description: "Keep the HTML report local only; skip publishing it to claude.ai",
            },
            {
              name: "--no-scaffold",
              description: "Explicitly skip scaffold_script",
            },
            {
              name: "--output-dir",
              description: "Directory for aggregate-result.json (default: ./<eval dir>/results/<timestamp>/)",
              args: {
                name: "dir",
              },
            },
            {
              name: "--publish-report",
              description: "Also require publishing the report to claude.ai (already the default when your account supports it); explains why if unavailable",
            },
            {
              name: "--report",
              description: "Write the self-contained HTML report (scores, prompts, grader verdicts) to <path> instead of the results dir",
              args: {
                name: "path",
              },
            },
            {
              name: "--runs",
              description: "Override per-case runs (default: case.runs ??",
              args: {
                name: "n",
              },
            },
            {
              name: "--scaffold",
              description: "Run each case's scaffold_script (runs author-supplied bash as you; off by default \u2014 only use on case files you authored)",
            },
            {
              name: "--tag",
              description: "Filter cases by tag (repeatable)",
              args: {
                name: "tag",
                isVariadic: true,
              },
            },
            {
              name: "--threshold",
              description: "Exit 1 if any case score is below this threshold (default: 1.0)",
              args: {
                name: "0..1",
              },
            },
            {
              name: "--trust-plugin",
              description:
                "Assert that you trust this plugin's code and eval suite, and skip the first-run trust prompt (for CI; like --dangerously-skip-permissions, only pass it for plug",
            },
            {
              name: "--verbose",
              description: "Log per-message trace events to the debug log (use --debug-file to read them)",
            },
          ],
          subcommands: [
            {
              name: "init",
              description:
                "Author an eval suite under the eval dir (evals/ unless --eval-dir or the manifest says otherwise) via an interview that sources inputs and designs graders.",
              args: [
                {
                  name: "options",
                  isOptional: true,
                },
                {
                  name: "name",
                  isOptional: true,
                },
              ],
            },
          ],
        },
        {
          name: ["init", "new"],
          description: "Scaffold a new plugin at ~/.claude/skills/<name>/ (auto-loads next session as <name>@skills-dir)",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "name",
            },
          ],
          options: [
            {
              name: "--author",
              description: "Author name (default: git config user.name)",
              args: {
                name: "name",
              },
            },
            {
              name: "--author-email",
              description: "Author email (default: git config user.email)",
              args: {
                name: "email",
              },
            },
            {
              name: "--description",
              description: "Manifest description",
              args: {
                name: "text",
              },
            },
            {
              name: ["-f", "--force"],
              description: "Overwrite an existing .claude-plugin/ at the target",
            },
            {
              name: "--with",
              description: "Also scaffold: skills, agents, hooks, mcp, lsp, output-style, channel",
              args: {
                name: "components",
                isVariadic: true,
              },
            },
          ],
        },
        {
          name: ["install", "i"],
          description: "Install a plugin from available marketplaces (use plugin@marketplace for specific marketplace)",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "plugin",
            },
          ],
          options: [
            {
              name: "--accept-command",
              description:
                "Accept the marketplace-declared command (a command-source install, or the headersHelper that fetches the archive) whose sha256 a previous --json run reported as",
              args: {
                name: "sha256",
              },
            },
            {
              name: "--config",
              description:
                "Set a userConfig option declared in the plugin's manifest, or a bundled .mcpb server's own user_config field as <server>.<key>=<value> (a bare key works when on",
              args: {
                name: "key=value",
              },
            },
            {
              name: "--json",
              description:
                "Print one machine-readable result line on stdout instead of the human message (same exit codes; a marketplace-declared command is still shown and must be confir",
            },
            {
              name: "--marketplace",
              description: "Install <plugin> (its bare name) from the marketplace at this source: owner/repo, a git or https URL, or a path.",
              args: {
                name: "source",
              },
            },
            {
              name: "--registry",
              description: "For a <package>@npm install: resolve and download from this npm registry instead of the one your npm configuration selects",
              args: {
                name: "url",
              },
            },
            {
              name: ["-s", "--scope"],
              description: 'Installation scope: user, project, or local (default: "user")',
              args: {
                name: "scope",
              },
            },
            {
              name: ["-y", "--yes"],
              description:
                "Accept the displayed marketplace-declared command without the confirmation prompt \u2014 a plugin installed by running a command, or one whose archive is fetched thr",
            },
          ],
        },
        {
          name: "list",
          description: "List installed plugins",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: "--available",
              description: "Include available plugins from marketplaces (requires --json)",
            },
            {
              name: "--data-size",
              description: "Measure each installed plugin's saved data directory, or only the named plugin's (requires --json)",
              args: {
                name: "plugin",
                isOptional: true,
              },
            },
            {
              name: "--json",
              description: "Output as JSON",
            },
          ],
        },
        {
          name: "marketplace",
          description: "Manage Claude Code marketplaces",
          subcommands: [
            {
              name: "add",
              description: "Add a marketplace from a URL, path, or GitHub repo",
              args: [
                {
                  name: "options",
                  isOptional: true,
                },
                {
                  name: "source",
                },
              ],
            },
            {
              name: "list",
              description: "List all configured marketplaces",
              args: {
                name: "options",
                isOptional: true,
              },
            },
            {
              name: ["remove", "rm"],
              description: "Remove a configured marketplace",
              args: [
                {
                  name: "options",
                  isOptional: true,
                },
                {
                  name: "name",
                },
              ],
            },
            {
              name: "update",
              description: "Update marketplace(s) from their source - updates all if no name specified",
              args: [
                {
                  name: "options",
                  isOptional: true,
                },
                {
                  name: "name",
                  isOptional: true,
                },
              ],
            },
          ],
        },
        {
          name: ["prune", "autoremove"],
          description: "Remove auto-installed dependencies that are no longer needed",
          args: {
            name: "options",
            isOptional: true,
          },
          options: [
            {
              name: "--dry-run",
              description: "List what would be removed without removing",
            },
            {
              name: ["-s", "--scope"],
              description: 'Prune at scope: user, project, or local (default: "user")',
              args: {
                name: "scope",
              },
            },
            {
              name: ["-y", "--yes"],
              description: "Skip the confirmation prompt (required when stdin or stdout is not a TTY)",
            },
          ],
        },
        {
          name: "tag",
          description: "Create a {name}--v{version} git tag for a plugin release, validating that plugin.json and any enclosing marketplace entry agree",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "path",
              isOptional: true,
            },
          ],
          options: [
            {
              name: "--dry-run",
              description: "Print what would be tagged without creating it",
            },
            {
              name: ["-f", "--force"],
              description: "Skip the dirty-working-tree and tag-already-exists checks",
            },
            {
              name: ["-m", "--message"],
              description: "Tag annotation message (use %s for the version)",
              args: {
                name: "msg",
              },
            },
            {
              name: "--push",
              description: "Push the tag to --remote after creating it",
            },
            {
              name: "--remote",
              description: 'Remote to push to with --push (default: "origin")',
              args: {
                name: "name",
              },
            },
          ],
        },
        {
          name: "test",
          description: "Run a mod's tests",
          args: {
            name: "dir",
            isOptional: true,
          },
        },
        {
          name: ["uninstall", "remove"],
          description: "Uninstall an installed plugin",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "plugin",
            },
          ],
          options: [
            {
              name: "--json",
              description: "Print one machine-readable result line on stdout instead of the human message (same exit codes; not with --prune)",
            },
            {
              name: "--keep-data",
              description: "Preserve the plugin's persistent data directory (~/.claude/plugins/data/{id}/)",
            },
            {
              name: "--prune",
              description: "Also remove auto-installed dependencies that are no longer needed (requires -y in non-interactive contexts)",
            },
            {
              name: ["-s", "--scope"],
              description: 'Uninstall from scope: user, project, or local (default: "user")',
              args: {
                name: "scope",
              },
            },
            {
              name: ["-y", "--yes"],
              description: "Skip the --prune confirmation prompt (required when stdin or stdout is not a TTY)",
            },
          ],
        },
        {
          name: "update",
          description: "Update a plugin to the latest version (restart required to apply)",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "plugin",
            },
          ],
          options: [
            {
              name: "--accept-command",
              description:
                "Accept the marketplace-declared command (a command-source install, or the headersHelper that fetches the archive) whose sha256 a previous --json run reported as",
              args: {
                name: "sha256",
              },
            },
            {
              name: "--json",
              description:
                "Print one machine-readable result line on stdout instead of the human message (same exit codes; a marketplace-declared command is still shown and must be confir",
            },
            {
              name: ["-s", "--scope"],
              description: "Installation scope: user, project, local, managed (default: auto-detect)",
              args: {
                name: "scope",
              },
            },
            {
              name: ["-y", "--yes"],
              description:
                "Accept the displayed marketplace-declared command without the confirmation prompt \u2014 a changed install command, or the headersHelper command that fetches its arc",
            },
          ],
        },
        {
          name: "validate",
          description: "Validate a plugin or marketplace manifest, or the skills, agents, and commands in a directory",
          args: [
            {
              name: "options",
              isOptional: true,
            },
            {
              name: "path",
            },
          ],
          options: [
            {
              name: "--json",
              description: "Output the validation report as JSON (same exit codes)",
            },
            {
              name: "--profile",
              description:
                "Also exit 1 when the plugin directory (the catalog that plugins are submitted to) would refuse a submission of the plugin on a check this command runs, such as ",
              args: {
                name: "name",
              },
            },
            {
              name: "--strict",
              description: "Treat warnings as errors (exit 1).",
            },
          ],
        },
      ],
    },
    {
      name: "purge",
      description: "Delete a project's Claude Code data (transcripts, tasks, file history, and its entry in ~/.claude.json) from this computer only",
      args: [
        {
          name: "options",
          isOptional: true,
        },
        {
          name: "path",
          isOptional: true,
        },
      ],
      options: [
        {
          name: "--all",
          description: "Purge state for every project (mutually exclusive with [path])",
        },
        {
          name: "--dry-run",
          description: "List what would be deleted without deleting anything",
        },
        {
          name: ["-i", "--interactive"],
          description: "Prompt for each item before deleting",
        },
        {
          name: ["-y", "--yes"],
          description: "Skip confirmation prompt",
        },
      ],
    },
    {
      name: "respawn",
      description: "Restart a background session, or all of them with --all, so it runs the current Claude Code version",
      args: [
        {
          name: "options",
          isOptional: true,
        },
        {
          name: "id",
          isOptional: true,
        },
      ],
    },
    {
      name: "rm",
      description: "Delete a background session, and its worktree when that is safe.",
      args: {
        name: "id",
      },
    },
    {
      name: "setup-token",
      description: "Set up a long-lived authentication token (requires Claude subscription)",
    },
    {
      name: ["stop", "kill"],
      description: "Stop a background session.",
      args: {
        name: "id",
      },
    },
    {
      name: "ultrareview",
      description: "Run a cloud-hosted multi-agent code review of the current branch (or a PR number / base branch) and print the findings",
      args: [
        {
          name: "options",
          isOptional: true,
        },
        {
          name: "target",
          isOptional: true,
        },
      ],
      options: [
        {
          name: "--json",
          description: "Print the raw bugs.json payload instead of formatted findings",
        },
        {
          name: "--no-post",
          description: "Do not post the findings to the PR (the default; accepted for parity with the /ultrareview and /code-review ultra flags)",
        },
        {
          name: "--post",
          description: "Post the finished review's findings to the PR as you (PR targets only; one plain comment, not a review)",
        },
        {
          name: "--timeout",
          description: "Maximum minutes to wait for the review to finish (default: 45)",
          args: {
            name: "minutes",
          },
        },
        {
          name: "--trust-workspace",
          description: "Trust the current folder for this run only, without asking (for scripts and CI).",
        },
      ],
    },
    {
      name: ["update", "upgrade"],
      description: "Check for updates and install if available; package-manager installs update through the package manager",
    },
  ],
};

export default completionSpec;
