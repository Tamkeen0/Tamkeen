# Agent write isolation (read all, write own)
Git checks protect accepted changes, not the working directory. Use an actual agent sandbox if it supports read-only workspace + explicitly writable paths. Choose the repository as read-only, whitelist ONLY your module (see scope-policy.json), and block .git, root config, other directories, and external writable repository copies. Keep GitHub write tokens out of the agent environment; do not let it invoke host tools that escape the sandbox. The human owns commits and pushes. An agent with full-access mode is not isolated, even if its prompt says otherwise.

If your chosen agent has no reliable path sandbox, an optional container can enforce a read-only checkout plus writable overlay for its owned directory. Example Docker mount layout for frontend agent on Linux/WSL (requires a container image with your chosen agent and its tooling already installed):

```sh
repo=$(pwd -P)
docker run --rm -it \
  --mount "type=bind,source=$repo,target=/workspace,readonly" \
  --mount "type=bind,source=$repo/frontend/src/ui,target=/workspace/frontend/src/ui" \
  --workdir /workspace YOUR_AGENT_IMAGE
```

Replace the writable directory with `document_engine` or `frontend/src/voice` for the other module agents. For the backend lead agent, mount `backend`, `contracts`, `fixtures`, `tests` as writable separately and make shared scaffold edits yourself, or explicitly mount only permitted files. No privileged container, host Docker socket, host SSH agent, write-capable GitHub token, unrestricted host mounts or sudo. Put temporary build/test outputs in container-local storage; install dependencies as a human before coding, or use container-local dependency volumes. A read-only parent mount may expose Git metadata and ignored files: keep secrets outside the shared checkout and prefer a clean checkout. Verify with a harmless attempted write outside scope (must fail) and a test write inside (must succeed, then delete it) before granting access. This example is a mount design, not an installed or tested agent environment. Choose agent-specific setup after deciding tools.

# Strongest GitHub arrangement
If repo visibility/plan and event rules permit: lead owns upstream, teammates have read access, fork upstream and open PRs from their forks. Lead alone has upstream write/admin rights. This is still one canonical project and avoids relying on trust that other write collaborators won't merge. On each teammate laptop: clone upstream (`origin`), add their fork as `fork` remote, create exact assigned feature branch from main, install hooks, push to `fork` rather than origin. PR base is upstream main, head is teammate fork + assigned branch. The guard validates PR author's configured login and changed paths, irrespective of fork vs same repo. Lead uses canonical origin for review. Verify private forks are permitted before choosing private fork workflow. If same-repo collaboration is necessary, use protected branches, CODEOWNERS and lead-only merge restrictions if supported. Never assume a private free personal repository offers branch protection. Use trusted local guard before every merge regardless of CI.
