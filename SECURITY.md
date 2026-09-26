# Security Policy

## Supported versions

The most recent release is supported. QuickRem runs inside the GNOME Shell
process, so it is only ever supported on the Shell versions named in
`metadata.json`: GNOME Shell 49 and 50.

## Reporting a vulnerability

Report privately through GitHub's
[security advisory form](https://github.com/Ghost-Assembly/quickrem/security/advisories/new)
rather than opening a public issue.

Please include the Shell version, the extension version from `metadata.json`,
and the steps to reproduce. You should get an acknowledgment within a week.

## Scope

QuickRem has no network access and stores no credentials of its own. It reads
files the user already owns and asks another application to open one.

**The profile directory is trusted.** Opening a profile hands it to Remmina, and
Remmina acts on what the profile says: a profile with `protocol=EXEC` runs its
`execcommand`, and SSH profiles can carry commands to run before and after
connecting. So clicking a profile can run commands, by design, with the user's
privileges. Anyone who can write a `.remmina` file into the profile directory —
or change `profile-dir` or `datadir_path` to point somewhere they can write —
can therefore get a command run the next time that profile is clicked. QuickRem
does not and cannot defend against that; keep the profile directory writable
only by you. What QuickRem does promise is below.

The realistic security surface is:

- **Profile contents.** `.remmina` files are parsed in the Shell process.
  `modules/profiles.js` drops every `password`, `passphrase` and `secret` key
  while parsing, so Remmina's encrypted values are never held, displayed or
  logged. Anything that gets one of them into a menu label, a subtitle or the
  journal is in scope.
- **Reading files.** Only regular files are read — a symlink to one is
  followed — and each read stops at 256 KiB, checked both when the directory is
  listed and while reading. A FIFO, a device node or a symlink to one (such as
  `/dev/zero`) is skipped without being opened. Anything that makes the Shell
  block on or exhaust itself reading a file in the profile directory is in
  scope.
- **The journal.** Log lines never name a profile: Remmina's default filename
  embeds the server's hostname. A log line that leaks a profile path, a
  hostname or a username is in scope.
- **Launching.** A profile is opened by handing its _path_ to the application
  registered for `application/x-remmina`. Paths come from the directory
  enumerator, never from a parsed field, so profile content cannot reach an
  argument vector. The `launch-command` setting is parsed with
  `GLib.shell_parse_argv` and the profile path is appended as a separate
  element, never interpolated. Anything that makes QuickRem itself execute
  profile content — as opposed to Remmina doing what the profile asks, above —
  is in scope.
- **The profile directory setting.** `profile-dir` is read from GSettings and
  used as a directory to enumerate; a leading `~` is expanded and anything that
  is still not absolute is refused rather than resolved against the Shell's
  working directory. It is the user's own setting, but anything that turns it
  into more than a read is in scope.
- **Shell stability.** Anything that crashes or hangs the Shell, or that leaks
  a signal handler or timeout across an enable/disable cycle, is in scope.

`remmina.pref` is read for one key, `datadir_path`. The `secret=` beside it —
the key Remmina encrypts stored passwords with — is never returned by
`parseDatadirPath` and never kept.
