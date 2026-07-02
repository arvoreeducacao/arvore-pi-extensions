#!/bin/bash
set -e

# Branches to lint and fix
BRANCHES=(
  "fix/stream-reliability"
  "fix/kiro-cli-snake-case"
  "fix/history-sanitization"
  "feat/expired-credential-fallback"
  "feat/bedrock-fallback"
)

echo "=== Building lint container ==="
docker build -f Dockerfile.lint -t pi-kiro-lint .

for branch in "${BRANCHES[@]}"; do
  echo ""
  echo "==================================================================="
  echo "Processing branch: $branch"
  echo "==================================================================="
  
  # Checkout branch
  git checkout "$branch"
  
  # Run lint check
  echo "--- Running lint check ---"
  if docker run --rm -v "$(pwd):/app" pi-kiro-lint npm run lint; then
    echo "✅ $branch: No lint issues"
  else
    echo "⚠️  $branch: Lint issues found, attempting to fix..."
    
    # Run lint fix
    docker run --rm -v "$(pwd):/app" pi-kiro-lint npm run lint:fix
    
    # Check if anything changed
    if git diff --quiet; then
      echo "⚠️  $branch: Lint reported issues but no auto-fixes available (manual fix needed)"
    else
      echo "✅ $branch: Lint issues auto-fixed"
      
      # Show what changed
      echo "--- Changes made ---"
      git diff --stat
      
      # Commit the fixes
      git add -A
      git commit -m "chore: fix lint issues"
      
      # Push to origin
      git push origin "$branch"
      
      echo "✅ $branch: Fixes committed and pushed"
    fi
  fi
done

echo ""
echo "==================================================================="
echo "All branches processed!"
echo "==================================================================="
git checkout main
