---
name: git-workflow
description: Git version control operations — clone, branch, commit, merge, resolve conflicts, inspect history. Use when working with git repositories.
---

# Git Workflow

## When to use
Use this skill when the user needs to:
- Clone or initialize repositories
- Create and manage branches
- Commit, push, and pull changes
- Resolve merge conflicts
- Inspect history and diffs

## Common operations

### Repository setup
```bash
git init                          # new repo
git clone <url>                   # clone existing
git remote add origin <url>       # add remote
```

### Branching
```bash
git branch <name>                 # create branch
git checkout <name>               # switch branch
git checkout -b <name>            # create + switch
git branch -d <name>              # delete branch
git branch -a                     # list all branches
```

### Daily workflow
```bash
git status                        # what's changed
git add .                         # stage all
git add <file>                    # stage specific
git commit -m "message"           # commit
git push origin <branch>          # push
git pull origin <branch>          # pull
```

### Inspection
```bash
git log --oneline -20             # recent history
git log --graph --oneline --all   # visual branch graph
git diff                          # unstaged changes
git diff --staged                 # staged changes
git show <commit>                 # specific commit
git blame <file>                  # line-by-line authorship
```

### Merge and rebase
```bash
git merge <branch>                # merge into current
git rebase <branch>               # rebase onto branch
git rebase -i HEAD~3              # interactive rebase
```

### Conflict resolution
1. Run `git status` to see conflicted files
2. Open each file and look for `<<<<<<<`, `=======`, `>>>>>>>` markers
3. Edit to keep the correct version
4. `git add <resolved-file>`
5. `git commit` (or `git rebase --continue`)

### Undo operations
```bash
git checkout -- <file>            # discard unstaged changes
git reset HEAD <file>             # unstage
git reset --soft HEAD~1           # undo last commit, keep changes
git reset --hard HEAD~1           # undo last commit, discard changes
git stash                         # temporarily shelve changes
git stash pop                     # restore stashed changes
```
