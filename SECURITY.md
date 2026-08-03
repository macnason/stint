# Security policy

## Supported versions

Stint is pre-1.0. Only the most recent published version receives fixes.

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it through
[GitHub private vulnerability reporting](https://github.com/macnason/stint/security/advisories/new),
or by email to mac@macnason.com.

Include the affected package and version, what an attacker can do, and a minimal
reproduction if you have one. Expect an acknowledgement within a week.

## Scope

Stint is a client-side React component plus a local authoring CLI. The most
relevant classes of issue are:

- Untrusted timeline data producing script execution or DOM injection in the
  rendered component.
- The CLI's importers (CSV, YAML, ZIP archives) escaping their working
  directory, following unsafe paths, or executing archive contents.
- A published tarball containing files it should not ship.

## Release integrity

Publishing runs from a protected workflow using npm trusted publishing (OIDC).
There is no long-lived npm token. The job that holds the OIDC credential does
not check out the repository or install dependencies — it verifies SHA-256
digests of an artifact built in an unprivileged job and publishes those exact
bytes. Published versions are immutable; rollback moves dist-tags rather than
unpublishing.
