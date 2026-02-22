# GitHub Authentication for Patch Creatures

This guide explains how to set up GitHub authentication for openseed creatures that need to create pull requests, open issues, and interact with repositories.

## Overview

Patch creatures (creatures with the purpose of reviewing and improving code) need GitHub access to:
- Clone repositories
- Create and push branches  
- Open pull requests
- Comment on PRs
- Create issues

There are **three authentication methods**, in order of preference:

1. **Janee** (recommended) — Secure credential proxy with no exposed tokens
2. **Environment Variables** — Direct token injection
3. **gh CLI** — Interactive authentication

## Method 1: Janee (Recommended)

Janee is a secure credential manager that acts as an MCP-enabled proxy between creatures and external APIs. Creatures never see raw API keys.

### Why Janee?

- ✓ No token exposure to creatures
- ✓ Per-creature access control
- ✓ Audit trail of all API calls
- ✓ Multi-creature support with isolated sessions
- ✓ Credential rotation without restarting creatures

### Setup

1. **Install Janee:**
   ```bash
   npm install -g @true-and-useful/janee
   ```

2. **Initialize configuration:**
   ```bash
   janee init
   ```
   
   This creates `~/.janee/config.yaml`.

3. **Add GitHub capability:**
   ```bash
   janee add github \
     --baseUrl https://api.github.com \
     --auth bearer:ghp_your_token_here
   ```

4. **Configure patch creature access:**
   
   Edit `~/.janee/config.yaml`:
   ```yaml
   server:
     defaultAccess: restricted
   
   capabilities:
     openseed-patch-exec:
       service: github
       allowedAgents: ["creature:patch"]
       autoApprove: true
   ```

   **Important:** The capability name must be `openseed-patch-exec` for patch creatures to use it.

5. **Start openseed:**
   
   When you start openseed, it automatically spawns Janee as a child process and injects `JANEE_URL` into creature environments.

### Verifying Janee Setup

From within a creature, use:

```bash
bash .self/skills/verify-github-auth-setup.sh
```

Or manually check:

```bash
# Check if Janee is available
curl -s $JANEE_URL/health

# List available capabilities (requires janee tool)
janee list_services
```

### Using Janee in Creatures

Creatures access Janee via the `janee` tool:

```typescript
// Check status
await janee({ action: 'status' });

// List available services
await janee({ action: 'list_services' });

// Execute git commands with injected credentials
await janee({
  action: 'exec',
  capability: 'openseed-patch-exec',
  command: ['git', 'push', 'origin', 'fix-branch'],
  reason: 'Push changes for PR'
});

// Create a pull request
await janee({
  action: 'exec', 
  capability: 'openseed-patch-exec',
  command: ['gh', 'pr', 'create', '--title', 'Fix bug', '--body', 'Description'],
  reason: 'Open PR for bug fix'
});
```

The `exec` action runs commands with `GITHUB_TOKEN` injected, so `git` and `gh` work seamlessly.

## Method 2: Environment Variables

If Janee is not available, creatures fall back to environment token variables.

### Setup

1. **Generate a GitHub Personal Access Token:**
   - Go to https://github.com/settings/tokens
   - Generate a classic token with `repo` scope
   - Copy the token (starts with `ghp_`)

2. **Export the token:**
   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   # or
   export GH_TOKEN=ghp_your_token_here
   ```

3. **Make it persistent:**
   
   Add to `~/.bashrc` or `~/.profile`:
   ```bash
   export GITHUB_TOKEN=ghp_your_token_here
   ```

4. **Restart your shell** or source the file:
   ```bash
   source ~/.bashrc
   ```

### Verification

```bash
# Check token is set
echo $GITHUB_TOKEN | wc -c  # Should show ~40 characters

# Test with gh CLI
gh auth status
```

### Security Note

⚠️ Environment variables expose the token to all processes. Consider:
- Using per-creature environment isolation
- Rotating tokens regularly
- Using fine-grained tokens with minimal scopes
- Preferring Janee for production environments

## Method 3: gh CLI Interactive Authentication

Useful for local development or manual testing.

### Setup

1. **Install gh CLI** (if not already installed):
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | \
     sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
     https://cli.github.com/packages stable main" | \
     sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
   sudo apt update
   sudo apt install gh
   ```

2. **Authenticate:**
   ```bash
   gh auth login
   ```
   
   Follow the prompts to authenticate via browser or paste a token.

3. **Verify:**
   ```bash
   gh auth status
   ```

### Limitations

- ❌ Not suitable for headless/containerized environments
- ❌ No access control or audit trail
- ❌ Credentials tied to user's global git config

## Authentication Priority

Creatures attempt authentication in this order:

1. **Check for Janee**: If `JANEE_URL` is set and `openseed-patch-exec` capability exists
2. **Check for tokens**: If `GITHUB_TOKEN` or `GH_TOKEN` environment variables exist
3. **Check gh CLI**: If `gh auth status` succeeds

If all methods fail, the creature documents findings without creating PRs.

## Troubleshooting

### "Janee not available"

**Symptoms:**
- `JANEE_URL` not set
- `curl $JANEE_URL/health` fails

**Solutions:**
1. Check Janee is installed: `which janee`
2. Check config exists: `ls ~/.janee/config.yaml`
3. Manually start Janee: `janee serve`
4. Check logs: `journalctl -u janee` or container logs

### "openseed-patch-exec capability not found"

**Symptoms:**
- Janee is running
- `janee list_services` doesn't show the capability

**Solutions:**
1. Check capability name in `~/.janee/config.yaml` (must be exactly `openseed-patch-exec`)
2. Verify `allowedAgents` includes your creature identity (e.g., `creature:patch`)
3. Restart Janee: `pkill janee && janee serve`

### "gh auth status" fails but token is set

**Symptoms:**
- `GITHUB_TOKEN` is set
- `gh auth status` shows "not authenticated"

**Solutions:**
```bash
# Inject token into gh CLI
gh auth login --with-token <<< $GITHUB_TOKEN

# Or use git credential helper
git config --global credential.helper store
```

### "Permission denied (publickey)" on push

**Symptoms:**
- Authentication works for API calls
- `git push` fails with SSH error

**Solutions:**
```bash
# Use HTTPS instead of SSH
git remote set-url origin https://github.com/openseed-io/openseed.git

# Or configure URL rewriting
git config --global url."https://github.com/".insteadOf git@github.com:
```

### Token has insufficient permissions

**Symptoms:**
- Authentication succeeds
- PR creation fails with 403/404

**Solutions:**
1. Verify token has `repo` scope (for private repos) or `public_repo` (for public)
2. Check organization settings allow personal access tokens
3. Regenerate token with correct scopes

## Testing Your Setup

Use the verification skill:

```bash
cd /creature
bash .self/skills/verify-github-auth-setup.sh
```

This checks all three authentication methods and reports which ones work.

## Best Practices

### For Operators

- ✓ Use Janee in production environments
- ✓ Configure per-creature access control
- ✓ Rotate tokens regularly
- ✓ Monitor Janee audit logs
- ✓ Use fine-grained tokens with minimal scopes

### For Creature Developers

- ✓ Test all three authentication methods
- ✓ Gracefully fall back when auth fails
- ✓ Document findings even when PRs can't be created
- ✓ Use the `janee` tool's `reason` parameter for audit trails
- ✓ Check authentication before attempting git operations

### For Contributors

- ✓ Document authentication requirements in genomes
- ✓ Provide fallback behaviors for offline/restricted environments
- ✓ Test creatures in environments without GitHub access

## Security Considerations

### Token Scopes

Minimum required scopes for patch creatures:
- `repo` (for private repositories) or `public_repo` (for public only)
- `workflow` (if modifying GitHub Actions)

### Access Control

When using Janee:
- Set `defaultAccess: restricted` to deny by default
- Use `allowedAgents` to whitelist specific creatures
- Consider `autoApprove: false` for sensitive operations

### Token Rotation

Recommended rotation schedule:
- Development tokens: 90 days
- Production tokens: 30 days
- Emergency rotation if token exposed

### Audit Trail

Janee logs all API calls with:
- Timestamp
- Creature identity
- Capability used
- Request details
- Response status

Monitor these logs for:
- Unexpected API usage
- Failed authentication attempts
- Rate limit warnings

## References

- [Janee Documentation](https://github.com/rsdouglas/janee)
- [Janee in openseed](../docs/janee-secrets.md)
- [GitHub Token Scopes](https://docs.github.com/en/developers/apps/building-oauth-apps/scopes-for-oauth-apps)
- [gh CLI Manual](https://cli.github.com/manual/)

## Quick Reference

| Method | Setup Time | Security | Multi-Creature | Audit Trail |
|--------|-----------|----------|----------------|-------------|
| Janee | 5 min | ⭐⭐⭐⭐⭐ | ✓ | ✓ |
| Token | 2 min | ⭐⭐⭐ | ✗ | ✗ |
| gh CLI | 2 min | ⭐⭐⭐ | ✗ | ✗ |

**Recommendation:** Use Janee for all production deployments. Use tokens or gh CLI only for local development and testing.

---

**[← Back to Documentation Index](README.md)**
