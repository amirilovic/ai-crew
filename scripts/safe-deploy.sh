#!/bin/bash
# Canary Deployment Script for Agent Dev Crew
#
# This script implements a staged rollout where one agent (the "canary")
# is restarted first to validate new code before rolling out to all agents.
#
# Deployment order (least to most critical):
#   1. architect (canary) - least critical, tests new code
#   2. qa - needs to be up for PR testing
#   3. dev - needs to be up for development work
#   4. po - most critical, coordinates the team
#
# Auto-rollback:
#   If the canary fails, the script automatically reverts the last commit,
#   rebuilds, and restarts the canary with the safe code.
#   Use --no-rollback to disable this behavior.
#
# Usage:
#   ./scripts/safe-deploy.sh               # Build and deploy with canary + auto-rollback
#   ./scripts/safe-deploy.sh --skip-build  # Deploy without building (use existing dist/)
#   ./scripts/safe-deploy.sh --no-rollback # Disable auto-rollback on failure
#
# Environment variables:
#   DISCORD_WEBHOOK_URL - Optional webhook URL for failure alerts
#
# The script will abort if the canary fails, leaving other agents on working code.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Configuration
CANARY_AGENT="architect"
CANARY_WAIT_SECONDS=120  # Wait 2 minutes for canary to stabilize
ROLLOUT_WAIT_SECONDS=30  # Wait 30 seconds between other agents
MIN_UPTIME_SECONDS=60    # Agent must be up for 60s to be considered healthy

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Send alert to Discord webhook (if configured)
discord_alert() {
    local message=$1

    if [[ -z "$DISCORD_WEBHOOK_URL" ]]; then
        log_warn "DISCORD_WEBHOOK_URL not set, skipping Discord alert"
        return 0
    fi

    log_info "Sending Discord alert..."

    # Escape special characters for JSON
    local escaped_message
    escaped_message=$(echo "$message" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')

    curl -s -X POST "$DISCORD_WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"content\": \"$escaped_message\"}" \
        > /dev/null 2>&1 || log_warn "Failed to send Discord alert"
}

# Perform auto-rollback: revert HEAD, rebuild, and restart canary
auto_rollback() {
    local failed_commit
    local commit_message

    log_warn "=== AUTO-ROLLBACK INITIATED ==="

    cd "$PROJECT_DIR"

    # Get info about the commit we're reverting
    failed_commit=$(git rev-parse --short HEAD)
    commit_message=$(git log -1 --pretty=%s)

    log_info "Reverting commit $failed_commit: $commit_message"

    # Revert the last commit
    if ! git revert HEAD --no-edit; then
        log_error "Failed to revert commit. Manual intervention required."
        discord_alert "⚠️ **Canary Deployment FAILED**\n\nCommit \`$failed_commit\` crashed the canary ($CANARY_AGENT).\n\n**Auto-rollback FAILED** - manual intervention required.\n\nInvestigate: \`pm2 logs $CANARY_AGENT --lines 100\`"
        exit 1
    fi

    log_info "Commit reverted. Rebuilding..."

    # Rebuild with reverted code
    if ! pnpm run build; then
        log_error "Build failed after revert. Manual intervention required."
        discord_alert "⚠️ **Canary Deployment FAILED**\n\nCommit \`$failed_commit\` crashed the canary ($CANARY_AGENT).\n\n**Build failed after revert** - manual intervention required."
        exit 1
    fi

    log_info "Restarting canary with reverted code..."

    # Restart canary with safe code
    pm2 restart "$CANARY_AGENT"

    # Wait for canary to stabilize with reverted code
    if wait_for_health "$CANARY_AGENT" "$CANARY_WAIT_SECONDS"; then
        log_info "Canary recovered with reverted code!"
        discord_alert "⚠️ **Canary Deployment FAILED - Auto-Rolled Back**\n\nCommit \`$failed_commit\` (\`$commit_message\`) crashed the canary ($CANARY_AGENT).\n\n✅ **Auto-rollback successful** - reverted to previous working code.\n\nOther agents were NOT affected.\n\nTo investigate:\n\`\`\`\npm2 logs $CANARY_AGENT --lines 100\ngit show $failed_commit\n\`\`\`"
    else
        log_error "Canary still failing after rollback. Manual intervention required."
        discord_alert "⚠️ **CRITICAL: Canary Deployment FAILED**\n\nCommit \`$failed_commit\` crashed the canary ($CANARY_AGENT).\n\n❌ **Canary still failing after auto-rollback** - manual intervention required.\n\nThis may indicate a deeper issue."
        exit 1
    fi

    log_warn "Deployment aborted due to canary failure. Other agents remain on previous code."
    exit 0
}

# Check if PM2 is available
check_pm2() {
    if ! command -v pm2 &> /dev/null; then
        log_error "PM2 is not installed. Run: npm install -g pm2"
        exit 1
    fi
}

# Build the project
build_project() {
    log_info "Building project..."
    cd "$PROJECT_DIR"
    pnpm run build
    log_info "Build complete"
}

# Check if an agent is healthy (online and running for at least MIN_UPTIME_SECONDS)
check_agent_health() {
    local agent=$1
    local status
    local uptime_ms

    # Get PM2 JSON status for the agent
    status=$(pm2 jlist 2>/dev/null | jq -r ".[] | select(.name == \"$agent\") | .pm2_env.status" 2>/dev/null || echo "unknown")

    if [[ "$status" != "online" ]]; then
        return 1
    fi

    # Get uptime in milliseconds
    uptime_ms=$(pm2 jlist 2>/dev/null | jq -r ".[] | select(.name == \"$agent\") | .pm2_env.pm_uptime" 2>/dev/null || echo "0")

    if [[ -z "$uptime_ms" || "$uptime_ms" == "null" ]]; then
        return 1
    fi

    # Calculate uptime in seconds
    local now_ms=$(($(date +%s) * 1000))
    local uptime_seconds=$(( (now_ms - uptime_ms) / 1000 ))

    if [[ $uptime_seconds -ge $MIN_UPTIME_SECONDS ]]; then
        return 0
    else
        return 1
    fi
}

# Wait for an agent to become healthy
wait_for_health() {
    local agent=$1
    local max_wait=$2
    local waited=0
    local check_interval=10

    log_info "Waiting up to ${max_wait}s for $agent to become healthy..."

    while [[ $waited -lt $max_wait ]]; do
        if check_agent_health "$agent"; then
            log_info "$agent is healthy (online for ${MIN_UPTIME_SECONDS}+ seconds)"
            return 0
        fi

        sleep $check_interval
        waited=$((waited + check_interval))
        echo -n "."
    done

    echo ""
    return 1
}

# Deploy canary agent
deploy_canary() {
    local enable_rollback=$1

    log_info "=== PHASE 1: Deploying canary ($CANARY_AGENT) ==="

    pm2 restart "$CANARY_AGENT"

    if ! wait_for_health "$CANARY_AGENT" "$CANARY_WAIT_SECONDS"; then
        log_error "CANARY FAILED! $CANARY_AGENT did not become healthy within ${CANARY_WAIT_SECONDS}s"

        if [[ "$enable_rollback" == "true" ]]; then
            auto_rollback
            # auto_rollback exits, so we won't reach here
        fi

        log_error "Aborting deployment. Other agents remain on previous working code."
        log_error ""
        log_error "To investigate:"
        log_error "  pm2 logs $CANARY_AGENT --lines 100"
        log_error ""
        log_error "To recover canary:"
        log_error "  1. Fix the bug"
        log_error "  2. Run: pnpm run build && pm2 restart $CANARY_AGENT"
        log_error ""
        log_error "To auto-rollback manually:"
        log_error "  git revert HEAD --no-edit && pnpm run build && pm2 restart $CANARY_AGENT"
        exit 1
    fi

    log_info "Canary deployment successful!"
}

# Deploy remaining agents
deploy_remaining() {
    local agents=("qa" "dev" "po")

    log_info "=== PHASE 2: Rolling out to remaining agents ==="

    for agent in "${agents[@]}"; do
        log_info "Restarting $agent..."
        pm2 restart "$agent"

        if ! wait_for_health "$agent" "$ROLLOUT_WAIT_SECONDS"; then
            log_warn "$agent may not have stabilized yet, but continuing..."
            log_warn "Monitor with: pm2 logs $agent"
        fi
    done

    log_info "All agents restarted!"
}

# Show final status
show_status() {
    log_info "=== DEPLOYMENT COMPLETE ==="
    echo ""
    pm2 status
    echo ""
    log_info "All agents deployed successfully!"
    log_info "Monitor logs: pm2 logs"
}

# Main execution
main() {
    local skip_build=false
    local enable_rollback=true

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-build)
                skip_build=true
                shift
                ;;
            --no-rollback)
                enable_rollback=false
                shift
                ;;
            -h|--help)
                echo "Usage: $0 [--skip-build] [--no-rollback]"
                echo ""
                echo "Options:"
                echo "  --skip-build    Skip the build step (use existing dist/)"
                echo "  --no-rollback   Disable auto-rollback on canary failure"
                echo "  -h, --help      Show this help message"
                echo ""
                echo "Environment variables:"
                echo "  DISCORD_WEBHOOK_URL  Optional webhook URL for failure alerts"
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done

    check_pm2

    if [[ "$skip_build" == "false" ]]; then
        build_project
    else
        log_warn "Skipping build step (--skip-build)"
    fi

    if [[ "$enable_rollback" == "false" ]]; then
        log_warn "Auto-rollback disabled (--no-rollback)"
    fi

    deploy_canary "$enable_rollback"
    deploy_remaining
    show_status
}

main "$@"
