# Deploy lite to GitHub Pages

Two-branch flow, no CI:
- `gh-pages-src` — source (this branch)
- `gh-pages` — built static site served at <https://s045pd.github.io/wargame-replay/>

## Recipe

Run from this repo root.

```bash
# 1. Build. Use vite directly — `npm run build` chains tsc -b which
#    fails on pre-existing engine/types vs lib/api type mismatches.
npx vite build

# 2. Check out gh-pages in a temp worktree.
git worktree add /tmp/wgr-gh-pages gh-pages

# 3. Replace ONLY build artifacts. NEVER rm -rf the worktree —
#    `games/` is data-bearing (see Gotcha below).
cd /tmp/wgr-gh-pages
rm -rf assets
cp -R ../../dist/assets ./assets
cp ../../dist/index.html ./index.html
cp ../../dist/favicon.png ../../dist/favicon.svg ../../dist/sql-wasm.wasm ./

# 4. Sanity-check the diff before committing.
git status -sb
git diff --stat
# Expect ONLY: assets/index-<hash>.js renamed, index.html script src updated.
# If `games/` shows any change → stop, see Gotcha.

# 5. Commit + push.
git add -A
git commit -m "build: deploy <one-line description>"
git push origin gh-pages

# 6. Clean up.
cd -
git worktree remove /tmp/wgr-gh-pages
```

## Gotcha: don't wipe `games/`

The `games/` directory on `gh-pages` holds the **production** game catalog and uploaded archives:
- `games/index.json` — curated list of available games (real names, player counts). Diverges from `public/games/index.json` in source, which is just a placeholder seed.
- `games/data/*.db` and `games/data/*.txt` — uploaded game archives. These exist **only** on `gh-pages`. They are never in `dist/` and never in source.

If you `rm -rf` the worktree before copying `dist/` over, you stage the deletion of all of these. The fix is to never wipe — only overwrite the build artifacts as shown in the recipe. If you slip and `git status` shows `D games/data/*` or `M games/index.json`, run `git restore games/` before committing.

## Adding a new game

Game uploads land on `gh-pages` directly via the in-app "upload to GitHub" flow (gh-pages variant of the upload feature) — they bypass `gh-pages-src` entirely. The `games/index.json` is updated as part of that flow. Do not edit it from the source branch.
