---
name: package-manager
description: Install, update, remove, and manage software packages on Debian/Ubuntu systems using apt. Use when the user needs to install software or manage dependencies.
---

# Package Manager

## When to use
Use this skill when the user wants to:
- Install new software
- Update existing packages
- Remove packages
- Search for available packages
- Fix dependency issues
- Manage package repositories

## Package operations

### Install
```bash
sudo apt update && sudo apt install -y <package>
```

### Remove
```bash
sudo apt remove <package>       # keep config files
sudo apt purge <package>        # remove everything
sudo apt autoremove             # clean unused deps
```

### Search
```bash
apt search <keyword>
apt show <package>              # detailed info
dpkg -l | grep <keyword>        # installed packages only
```

### Update system
```bash
sudo apt update                 # refresh package index
sudo apt upgrade -y             # upgrade all packages
sudo apt full-upgrade -y        # upgrade with dependency changes
```

## Troubleshooting

### Broken packages
```bash
sudo apt --fix-broken install
sudo dpkg --configure -a
```

### Lock file issues
```bash
sudo rm /var/lib/dpkg/lock-frontend
sudo rm /var/lib/apt/lists/lock
sudo dpkg --configure -a
```

### Check what's installed
```bash
dpkg --get-selections | grep <package>
apt list --installed | grep <keyword>
```
